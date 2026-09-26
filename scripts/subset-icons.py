#!/usr/bin/env python3
"""
Shrinks the Material Symbols icon font (5 MB, ~3,800 icons) to just the icons Nudge uses.

It scans the source for words that are icon names, keeps only those ligatures, and pins the
variable axes Nudge doesn't change (grade 0, optical size 20; weight 300-400; fill 0-1).
A smaller font loads faster on the Pi and phones, and — more importantly — makes every text
layout with icons cheaper, since Chromium no longer walks thousands of ligature rules.

    pip install fonttools brotli
    python3 scripts/subset-icons.py            # rebuild shared/src/fonts/icons.woff2
    python3 scripts/subset-icons.py --check    # CI: fail if the source uses an icon the font lacks
"""
import io
import json
import re
import sys
from pathlib import Path

from fontTools import subset
from fontTools.ttLib import TTFont
from fontTools.varLib import instancer

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "node_modules/material-symbols/material-symbols-rounded.woff2"
OUT = ROOT / "shared/src/fonts/icons.woff2"
LIST = ROOT / "shared/src/fonts/icons.json"
SCAN = ["shared/src", "pi-screen/src", "apps/src", "pi-hub/src", "windows-desktop/src", "windows-desktop/extension"]
# Icons built from pieces at runtime, or chosen by people (reward icons), that a scan can't see.
EXTRA = {"redeem", "cake", "sports_esports", "movie", "headphones", "icecream", "local_pizza", "stadium", "palette"}


def ligatures(font: TTFont) -> dict[str, str]:
    """icon name -> glyph name, from the font's liga lookups."""
    rev = {g: chr(c) for c, g in font.getBestCmap().items()}
    out: dict[str, str] = {}
    for lookup in font["GSUB"].table.LookupList.Lookup:
        for st in lookup.SubTable:
            st = getattr(st, "ExtSubTable", st)
            for first, ligs in getattr(st, "ligatures", {}).items():
                for lig in ligs:
                    chars = [rev.get(first)] + [rev.get(c) for c in lig.Component]
                    if all(chars):
                        out["".join(chars)] = lig.LigGlyph
    return out


def used_names(all_names: set[str]) -> set[str]:
    words: set[str] = set()
    for d in SCAN:
        for p in (ROOT / d).rglob("*"):
            if p.suffix in {".ts", ".tsx", ".js", ".mjs", ".html", ".css"} and "fonts" not in p.parts:
                words.update(re.findall(r"[a-z][a-z0-9_]{1,40}", p.read_text(encoding="utf-8", errors="ignore")))
    return (words & all_names) | (EXTRA & all_names)


def main() -> None:
    full = TTFont(str(SRC))
    ligs = ligatures(full)
    names = used_names(set(ligs))
    if "--check" in sys.argv:
        have = set(json.loads(LIST.read_text())) if LIST.exists() else set()
        missing = sorted(names - have)
        if missing:
            print("icons used but missing from the subset font:", ", ".join(missing))
            print("run: python3 scripts/subset-icons.py")
            sys.exit(1)
        print(f"icon font ok ({len(have)} icons)")
        return

    # Pin the axes we never animate, keep FILL and a narrow weight range.
    inst = instancer.instantiateVariableFont(full, {"GRAD": 0, "opsz": 20, "wght": (300, 400), "FILL": (0, 1)})
    buf = io.BytesIO()
    inst.save(buf)
    buf.seek(0)
    font = TTFont(buf)

    opts = subset.Options()
    opts.layout_features = ["liga", "rlig", "calt", "ccmp"]
    opts.layout_closure = False  # keep only the ligatures we ask for
    opts.flavor = "woff2"
    opts.notdef_outline = True
    opts.name_IDs = ["*"]
    sub = subset.Subsetter(opts)
    letters = "abcdefghijklmnopqrstuvwxyz0123456789_"
    sub.populate(glyphs=[ligs[n] for n in names], unicodes=[ord(c) for c in letters])
    sub.subset(font)
    OUT.parent.mkdir(parents=True, exist_ok=True)
    font.save(str(OUT))
    LIST.write_text(json.dumps(sorted(names), indent=0) + "\n")
    print(f"{len(names)} icons, {OUT.stat().st_size // 1024} KB (was {SRC.stat().st_size // 1024} KB)")


if __name__ == "__main__":
    main()
