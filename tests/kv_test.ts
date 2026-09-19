import { assertEquals } from "jsr:@std/assert@^1.0.0";
import { MemoryKv } from "../kv_memory.ts";
import type { CfEntry } from "../types.ts";

const sampleEntry: CfEntry = {
  value: "104.16.1.1",
  type: "ip",
  avgScore: 100,
  avgLatency: 80,
  avgPkgLost: 1,
};

Deno.test("MemoryKv: preferredIps round-trip", async () => {
  const kv = new MemoryKv();
  await kv.savePreferredIps([sampleEntry]);
  const loaded = await kv.loadPreferredIps();
  assertEquals(loaded, [sampleEntry]);
});

Deno.test("MemoryKv: blacklistIps round-trip", async () => {
  const kv = new MemoryKv();
  await kv.saveBlacklistIps(["1.2.3.4"]);
  assertEquals(await kv.loadBlacklistIps(), ["1.2.3.4"]);
});

Deno.test("MemoryKv: meta round-trip", async () => {
  const kv = new MemoryKv();
  await kv.saveMeta({ lastFetch: 1234, lastError: "boom" });
  const meta = await kv.loadMeta();
  assertEquals(meta.lastFetch, 1234);
  assertEquals(meta.lastError, "boom");
});

Deno.test("MemoryKv: empty store returns sensible defaults", async () => {
  const kv = new MemoryKv();
  assertEquals(await kv.loadPreferredIps(), []);
  assertEquals(await kv.loadBlacklistIps(), []);
  const meta = await kv.loadMeta();
  assertEquals(meta.lastFetch, 0);
  assertEquals(meta.lastError, null);
});
