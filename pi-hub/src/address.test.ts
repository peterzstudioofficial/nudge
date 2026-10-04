import { describe, expect, it } from "vitest";
import type os from "node:os";
import { publicBase } from "./address";

const nic = (address: string, internal = false) => ({ address, family: "IPv4", internal, netmask: "", mac: "", cidr: null }) as os.NetworkInterfaceInfo;

describe("the address a phone uses", () => {
  it("prefers the tailnet, then home Wi-Fi, never loopback", () => {
    const nets = { lo: [nic("127.0.0.1", true)], wlan0: [nic("192.168.1.40")], tailscale0: [nic("100.101.7.9")] };
    expect(publicBase({ port: 8787, tlsCert: null, env: {}, nets })).toBe("http://100.101.7.9:8787");
    expect(publicBase({ port: 8787, tlsCert: null, env: {}, nets: { lo: nets.lo, wlan0: nets.wlan0 } })).toBe("http://192.168.1.40:8787");
    expect(publicBase({ port: 8787, tlsCert: null, env: {}, nets: { lo: nets.lo } })).toBeNull();
  });
  it("an explicit address wins", () => {
    expect(publicBase({ port: 8787, tlsCert: null, env: { NUDGE_PUBLIC_URL: "https://nudge.tail1234.ts.net/" }, nets: {} })).toBe("https://nudge.tail1234.ts.net");
    expect(publicBase({ port: 8787, tlsCert: null, env: { NUDGE_PUBLIC_URL: "javascript:alert(1)" }, nets: {} })).toBeNull();
  });
});
