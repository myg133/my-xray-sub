import { assertEquals } from "jsr:@std/assert@^1.0.0";
import { buildVlessUri } from "../vless.ts";
import type { VlessParams } from "../types.ts";

const baseParams: VlessParams = {
  id: "d08096d7-2715-486a-925d-b2e506192385",
  host: "vr.ttmic.top",
  port: 443,
  path: "/P93750",
  network: "xhttp",
  security: "tls",
  sni: "vr.ttmic.top",
  alpn: "h2",
  fingerprint: "chrome",
  encryption: "none",
  mode: "auto",
};

Deno.test("buildVlessUri with IPv4 address", () => {
  const uri = buildVlessUri(baseParams, "104.16.123.45", "bwh-servers-1");
  assertEquals(
    uri,
    "vless://d08096d7-2715-486a-925d-b2e506192385@104.16.123.45:443?" +
      "encryption=none&security=tls&sni=vr.ttmic.top&alpn=h2&fp=chrome" +
      "&type=xhttp&host=vr.ttmic.top&path=%2FP93750&mode=auto#bwh-servers-1",
  );
});

Deno.test("buildVlessUri with domain address", () => {
  const uri = buildVlessUri(baseParams, "cdn.example.com", "ovh-1");
  assertEquals(
    uri,
    "vless://d08096d7-2715-486a-925d-b2e506192385@cdn.example.com:443?" +
      "encryption=none&security=tls&sni=vr.ttmic.top&alpn=h2&fp=chrome" +
      "&type=xhttp&host=vr.ttmic.top&path=%2FP93750&mode=auto#ovh-1",
  );
});

Deno.test("buildVlessUri URL-encodes remark with spaces", () => {
  const uri = buildVlessUri(baseParams, "104.16.1.1", "my node 1");
  assertEquals(uri.includes("#my%20node%201"), true);
});

Deno.test("buildVlessUri with path containing special chars", () => {
  const params = { ...baseParams, path: "/api/v2?foo=bar" };
  const uri = buildVlessUri(params, "104.16.1.1", "n");
  assertEquals(uri.includes("path=%2Fapi%2Fv2%3Ffoo%3Dbar"), true);
});