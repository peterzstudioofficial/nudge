# OpenRouter guardrail for Nudge

Set this once at **openrouter.ai → Settings → Guardrails**, then assign it to the key the Pi uses.
The hub already refuses expensive models itself; this is the second lock, on OpenRouter's side.

## 1. Model allowlist (recommended: paste this)

Only these can run. Everything else is blocked, including any expensive model released later.

```
deepseek/deepseek-v4.1-flash
deepseek/deepseek-v4-pro
z-ai/glm-5.3-flash
```

| model | what Nudge uses it for |
| --- | --- |
| `deepseek/deepseek-v4.1-flash` | every answer, tidying voice-note titles, building tools |
| `deepseek/deepseek-v4-pro` | the "tutor" it can ask on genuinely hard questions (capped per question) |
| `z-ai/glm-5.3-flash` | backup if the first one is down |

If you change a model in the setup page, add it here too, or its requests are refused (you'll see
"assistant not set up" style errors rather than a surprise bill).

## 2. Other guardrail settings

- **Budget**: $5 a month (matches the hub's own monthly limit; raise both together).
- **Zero Data Retention**: on (the hub asks for ZDR on every request; this enforces it).
- **Prompt-injection detection**: on (school emails are read by the assistant; this is a second
  check on top of the hub marking them as "information, not instructions").
- **Sensitive info**: redact (optional; costs nothing extra).

## 3. Banned families (if you'd rather use a blocklist)

The allowlist above already blocks all of these. If you use "ignored models" instead, search
OpenRouter's model picker for each of these and add every match:

- `anthropic/` — every Claude model (Opus, Sonnet, Fable, Haiku). Use Claude Code or Cowork on
  your computer for heavy jobs instead; that's your Claude plan, not credit.
- `openai/o1`, `o3`, `o4` and their `-pro` versions; `openai/gpt-5*` (the full, `-pro` and
  `-terra` versions; the `-mini`/`-nano` ones are cheap but not needed).
- `google/gemini-*-pro` (all Pro versions).
- `x-ai/grok-*` except the `-fast`/`-mini` ones.
- Anything priced above **$0.50 per million input tokens or $1.50 per million output tokens**
  (the hub also sends this as a price cap on every request, so such a model is never picked).

The same rule lives in the code: `EXPENSIVE_MODEL` in `shared/src/model.ts`.
