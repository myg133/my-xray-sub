import { assertEquals } from "jsr:@std/assert@^1.0.0";
import { handleSub } from "../sub.ts";
import { MemoryKv } from "../kv_memory.ts";
import type { KvStore } from "../kv_memory.ts";
import type { Config } from "../config.ts";
import type { CfEntry } from "../types.ts";

const cfg: Config = {
  port: 0,
  subToken: "secret-token",
  vps789Token: "",
  maxNodesIp: 20,
  scoreThreshold: 500,
  pkgLostThreshold: 10,
  kvRefreshCron: "",
};

const sample: CfEntry = {
  value: "104.16.1.1",
  type: "ip",
  avgScore: 100,
  avgLatency: 80,
  avgPkgLost: 1,
};

const baseUrl =
  "http://x/sub?group=bwh&id=d08096d7-2715-486a-925d-b2e506192385&path=%2FP93750&host=vr.ttmic.top";

Deno.test("handleSub: 404 when token missing", async () => {
  const kv = new MemoryKv();
  const res = await handleSub(new Request(baseUrl), cfg, kv);
  assertEquals(res.status, 404);
});

Deno.test("handleSub: 404 when token wrong", async () => {
  const kv = new MemoryKv();
  const req = new Request(baseUrl, { headers: { "X-Sub-Token": "wrong" } });
  const res = await handleSub(req, cfg, kv);
  assertEquals(res.status, 404);
});

Deno.test("handleSub: 400 when query param missing", async () => {
  const kv = new MemoryKv();
  const req = new Request("http://x/sub?id=u&path=/p&host=h", {
    headers: { "X-Sub-Token": "secret-token" },
  });
  const res = await handleSub(req, cfg, kv);
  assertEquals(res.status, 400);
});

Deno.test("handleSub: 200 with base64 when token valid + KV has data", async () => {
  const kv = new MemoryKv();
  await kv.savePreferredIps([sample]);
  const req = new Request(baseUrl, { headers: { "X-Sub-Token": "secret-token" } });
  const res = await handleSub(req, cfg, kv);
  assertEquals(res.status, 200);
  assertEquals(res.headers.get("content-type"), "text/plain; charset=utf-8");
  const body = await res.text();
  const decoded = atob(body);
  const lines = decoded.split("\n").filter(Boolean);
  assertEquals(lines.length, 1);
  assertEquals(
    lines[0].startsWith("vless://d08096d7-2715-486a-925d-b2e506192385@104.16.1.1:443?"),
    true,
  );
  assertEquals(lines[0].includes("#bwh-0"), true);
});

Deno.test("handleSub: 200 with single host-fallback URI when KV empty", async () => {
  const kv = new MemoryKv();
  const req = new Request(baseUrl, { headers: { "X-Sub-Token": "secret-token" } });
  const res = await handleSub(req, cfg, kv);
  assertEquals(res.status, 200);
  const body = await res.text();
  const decoded = atob(body);
  const lines = decoded.split("\n").filter(Boolean);
  assertEquals(lines.length, 1);
  assertEquals(lines[0].includes("@vr.ttmic.top:"), true);
});

Deno.test("handleSub: remark uses group-idx pattern", async () => {
  const kv = new MemoryKv();
  await kv.savePreferredIps([
    sample,
    { ...sample, value: "104.16.2.2" },
    { ...sample, value: "104.16.3.3" },
  ]);
  const req = new Request(baseUrl, { headers: { "X-Sub-Token": "secret-token" } });
  const res = await handleSub(req, cfg, kv);
  const body = atob(await res.text());
  const remarks = body.split("\n").map((l) => l.split("#")[1]);
  assertEquals(new Set(remarks).size, 3);
  for (const r of remarks) {
    assertEquals(r!.startsWith("bwh-"), true);
  }
});

Deno.test("handleSub: 503 when KV read fails", async () => {
  const kv: KvStore = {
    loadPreferredIps: () => Promise.reject(new Error("kv down")),
    savePreferredIps: () => Promise.resolve(),
    loadBlacklistIps: () => Promise.resolve([]),
    saveBlacklistIps: () => Promise.resolve(),
    loadMeta: () => Promise.resolve({ lastFetch: 0, lastError: null }),
    saveMeta: () => Promise.resolve(),
  };
  const req = new Request(baseUrl, { headers: { "X-Sub-Token": "secret-token" } });
  const res = await handleSub(req, cfg, kv);
  assertEquals(res.status, 503);
});
