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
  vps789YfToken: "",
  maxNodesIp: 20,
  maxNodesDomain: 20,
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
  carrierCode: "CT",
  carrierLatency: 86,
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
  assertEquals(lines[0].includes("#bwh-CT-86-0"), true);
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

Deno.test("handleSub: mixes IPs and domains in single subscription", async () => {
  const kv = new MemoryKv();
  await kv.savePreferredIps([
    sample,
    { ...sample, value: "104.16.2.2" },
  ]);
  await kv.savePreferredDomains([
    { ...sample, value: "cf.blogluo.eu.org", type: "domain" },
    { ...sample, value: "www.oopt.eu.cc", type: "domain" },
  ]);
  const req = new Request(baseUrl, { headers: { "X-Sub-Token": "secret-token" } });
  const res = await handleSub(req, cfg, kv);
  assertEquals(res.status, 200);
  const body = atob(await res.text());
  const lines = body.split("\n").filter(Boolean);
  assertEquals(lines.length, 4);
  assertEquals(lines.some((l) => l.includes("@104.16.1.1:")), true);
  assertEquals(lines.some((l) => l.includes("@104.16.2.2:")), true);
  assertEquals(lines.some((l) => l.includes("@cf.blogluo.eu.org:")), true);
  assertEquals(lines.some((l) => l.includes("@www.oopt.eu.cc:")), true);
  const remarks = lines.map((l) => decodeURIComponent(l.split("#")[1] ?? ""));
  for (const r of remarks) {
    assertEquals(r.startsWith("bwh-"), true);
  }
});

Deno.test("handleSub: serves IPs when only domains KV is empty", async () => {
  const kv = new MemoryKv();
  await kv.savePreferredIps([sample]);
  const req = new Request(baseUrl, { headers: { "X-Sub-Token": "secret-token" } });
  const res = await handleSub(req, cfg, kv);
  const body = atob(await res.text());
  const lines = body.split("\n").filter(Boolean);
  assertEquals(lines.length, 1);
  assertEquals(lines[0].includes("@104.16.1.1:"), true);
});

Deno.test("handleSub: serves domains when only IPs KV is empty", async () => {
  const kv = new MemoryKv();
  await kv.savePreferredDomains([
    { ...sample, value: "cf.blogluo.eu.org", type: "domain" },
  ]);
  const req = new Request(baseUrl, { headers: { "X-Sub-Token": "secret-token" } });
  const res = await handleSub(req, cfg, kv);
  const body = atob(await res.text());
  const lines = body.split("\n").filter(Boolean);
  assertEquals(lines.length, 1);
  assertEquals(lines[0].includes("@cf.blogluo.eu.org:"), true);
});

Deno.test("handleSub: 503 when KV read fails", async () => {
  const kv: KvStore = {
    loadPreferredIps: () => Promise.reject(new Error("kv down")),
    savePreferredIps: () => Promise.resolve(),
    loadPreferredDomains: () => Promise.resolve([]),
    savePreferredDomains: () => Promise.resolve(),
    loadBlacklistIps: () => Promise.resolve([]),
    saveBlacklistIps: () => Promise.resolve(),
    loadMeta: () => Promise.resolve({ lastFetch: 0, lastError: null }),
    saveMeta: () => Promise.resolve(),
  };
  const req = new Request(baseUrl, { headers: { "X-Sub-Token": "secret-token" } });
  const res = await handleSub(req, cfg, kv);
  assertEquals(res.status, 503);
});

Deno.test("handleSub: IP remark includes carrier code and latency", async () => {
  const kv = new MemoryKv();
  await kv.savePreferredIps([
    {
      value: "1.2.3.4",
      type: "ip",
      avgScore: 100,
      avgLatency: 50,
      avgPkgLost: 1,
      carrierCode: "CT",
      carrierLatency: 86,
    },
    {
      value: "5.6.7.8",
      type: "ip",
      avgScore: 200,
      avgLatency: 100,
      avgPkgLost: 1,
      carrierCode: "CU",
      carrierLatency: 188,
    },
  ]);
  const req = new Request(baseUrl, { headers: { "X-Sub-Token": "secret-token" } });
  const res = await handleSub(req, cfg, kv);
  const body = atob(await res.text());
  const lines = body.split("\n").filter(Boolean);
  assertEquals(lines[0].includes("#bwh-CT-86-0"), true, `expected #bwh-CT-86-0 in: ${lines[0]}`);
  assertEquals(lines[1].includes("#bwh-CU-188-1"), true, `expected #bwh-CU-188-1 in: ${lines[1]}`);
});

Deno.test("handleSub: Domain remark uses avgScore", async () => {
  const kv = new MemoryKv();
  await kv.savePreferredIps([]);
  await kv.savePreferredDomains([
    { value: "cf.blogluo.eu.org", type: "domain", avgScore: 105, avgLatency: 86, avgPkgLost: 0.4 },
    { value: "www.oopt.eu.cc", type: "domain", avgScore: 156, avgLatency: 116, avgPkgLost: 0.8 },
  ]);
  const req = new Request(baseUrl, { headers: { "X-Sub-Token": "secret-token" } });
  const res = await handleSub(req, cfg, kv);
  const body = atob(await res.text());
  const lines = body.split("\n").filter(Boolean);
  assertEquals(lines[0].includes("#bwh-Domain-105-0"), true);
  assertEquals(lines[1].includes("#bwh-Domain-156-1"), true);
});
