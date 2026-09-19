import { assertEquals } from "jsr:@std/assert@^1.0.0";
import { fetchAndStore } from "../scraper/mod.ts";
import { MemoryKv } from "../kv_memory.ts";
import type { Config } from "../config.ts";

const baseCfg: Config = {
  port: 0,
  subToken: "tok",
  vps789Token: "ips-token",
  vps789YfToken: "yf-token",
  maxNodesIp: 20,
  maxNodesDomain: 20,
  scoreThreshold: 500,
  pkgLostThreshold: 10,
  kvRefreshCron: "",
};

function makeStubFetch(ipsBody: string | null, domainsBody: string | null) {
  return (url: string | URL | Request, _init?: RequestInit) => {
    const u = String(url);
    if (u.includes("/cfIpApi")) {
      return Promise.resolve(
        new Response(ipsBody ?? "forbidden", { status: ipsBody ? 200 : 403 }),
      );
    }
    if (u.includes("/cfIpTop20")) {
      return Promise.resolve(
        new Response(domainsBody ?? "forbidden", { status: domainsBody ? 200 : 403 }),
      );
    }
    return Promise.reject(new Error(`unexpected URL: ${u}`));
  };
}

Deno.test("fetchAndStore: stores both IPs and domains on full success", async () => {
  const kv = new MemoryKv();
  const origFetch = globalThis.fetch;
  globalThis.fetch = makeStubFetch(
    JSON.stringify({
      code: 0,
      data: {
        CT: [{
          ip: "104.16.1.1",
          avgScore: 100,
          ydLatencyAvg: 50,
          ltLatencyAvg: 50,
          dxLatencyAvg: 50,
          ydPkgLostRateAvg: 1,
          ltPkgLostRateAvg: 1,
          dxPkgLostRateAvg: 1,
        }],
        CU: [],
        CM: [],
      },
    }),
    JSON.stringify({
      code: 0,
      data: {
        good: [{ ip: "cf.blogluo.eu.org", avgScore: 105, avgLatency: 86, avgPkgLostRate: 0.39 }],
      },
    }),
  );
  try {
    await fetchAndStore(baseCfg, kv);
    const ips = await kv.loadPreferredIps();
    const domains = await kv.loadPreferredDomains();
    assertEquals(ips.length, 1);
    assertEquals(ips[0].value, "104.16.1.1");
    assertEquals(ips[0].type, "ip");
    assertEquals(domains.length, 1);
    assertEquals(domains[0].value, "cf.blogluo.eu.org");
    assertEquals(domains[0].type, "domain");
    const meta = await kv.loadMeta();
    assertEquals(meta.lastError, null);
    assertEquals(meta.lastFetch > 0, true);
  } finally {
    globalThis.fetch = origFetch;
  }
});

Deno.test("fetchAndStore: keeps previous IPs when only domains fetch fails", async () => {
  const kv = new MemoryKv();
  await kv.savePreferredIps([
    { value: "old.ip", type: "ip", avgScore: 100, avgLatency: 50, avgPkgLost: 1 },
  ]);
  const origFetch = globalThis.fetch;
  globalThis.fetch = makeStubFetch(
    JSON.stringify({
      code: 0,
      data: { CT: [{ ip: "104.16.1.1", avgScore: 100 }], CU: [], CM: [] },
    }),
    null,
  );
  try {
    await fetchAndStore(baseCfg, kv);
    const ips = await kv.loadPreferredIps();
    assertEquals(ips[0].value, "104.16.1.1");
    const domains = await kv.loadPreferredDomains();
    assertEquals(domains.length, 0);
    const meta = await kv.loadMeta();
    assertEquals(meta.lastError?.startsWith("domains:"), true);
  } finally {
    globalThis.fetch = origFetch;
  }
});

Deno.test("fetchAndStore: keeps previous domains when only IPs fetch fails", async () => {
  const kv = new MemoryKv();
  await kv.savePreferredDomains([
    { value: "old.domain", type: "domain", avgScore: 100, avgLatency: 50, avgPkgLost: 1 },
  ]);
  const origFetch = globalThis.fetch;
  globalThis.fetch = makeStubFetch(
    null,
    JSON.stringify({
      code: 0,
      data: { good: [{ ip: "cf.blogluo.eu.org", avgScore: 105 }] },
    }),
  );
  try {
    await fetchAndStore(baseCfg, kv);
    const domains = await kv.loadPreferredDomains();
    assertEquals(domains[0].value, "cf.blogluo.eu.org");
    const ips = await kv.loadPreferredIps();
    assertEquals(ips.length, 0);
    const meta = await kv.loadMeta();
    assertEquals(meta.lastError?.startsWith("ips:"), true);
  } finally {
    globalThis.fetch = origFetch;
  }
});

Deno.test("fetchAndStore: preserves lastFetch when both fetches fail", async () => {
  const kv = new MemoryKv();
  const priorFetch = 1_700_000_000_000;
  await kv.saveMeta({ lastFetch: priorFetch, lastError: null });
  const origFetch = globalThis.fetch;
  globalThis.fetch = makeStubFetch(null, null);
  try {
    await fetchAndStore(baseCfg, kv);
    const meta = await kv.loadMeta();
    assertEquals(meta.lastFetch, priorFetch);
    assertEquals(meta.lastError?.includes("ips:"), true);
    assertEquals(meta.lastError?.includes("domains:"), true);
  } finally {
    globalThis.fetch = origFetch;
  }
});

Deno.test("fetchAndStore: applies per-list cap (MAX_NODES_IP / MAX_NODES_DOMAIN)", async () => {
  const kv = new MemoryKv();
  const cfg = { ...baseCfg, maxNodesIp: 2, maxNodesDomain: 1 };
  const ipList = Array.from({ length: 5 }, (_, i) => ({
    ip: `1.1.1.${i}`,
    avgScore: 100,
    ydLatencyAvg: 50,
    ltLatencyAvg: 50,
    dxLatencyAvg: 50,
    ydPkgLostRateAvg: 1,
    ltPkgLostRateAvg: 1,
    dxPkgLostRateAvg: 1,
  }));
  const domainList = Array.from({ length: 3 }, (_, i) => ({
    ip: `d${i}.example.com`,
    avgScore: 100,
    avgLatency: 50,
    avgPkgLostRate: 1,
  }));
  const origFetch = globalThis.fetch;
  globalThis.fetch = makeStubFetch(
    JSON.stringify({ code: 0, data: { CT: ipList, CU: [], CM: [] } }),
    JSON.stringify({ code: 0, data: { good: domainList } }),
  );
  try {
    await fetchAndStore(cfg, kv);
    const ips = await kv.loadPreferredIps();
    const domains = await kv.loadPreferredDomains();
    assertEquals(ips.length, 2);
    assertEquals(domains.length, 1);
  } finally {
    globalThis.fetch = origFetch;
  }
});
