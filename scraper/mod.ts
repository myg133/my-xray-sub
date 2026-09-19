import type { Config } from "../config.ts";
import type { KvStore } from "../kv_memory.ts";
import { fetchVps789Ips } from "./vps789.ts";
import { filterPreferred } from "./filter.ts";

export async function fetchAndStore(cfg: Config, kv: KvStore): Promise<void> {
  try {
    const entries = await fetchVps789Ips(cfg.vps789Token);
    const blacklist = await kv.loadBlacklistIps();
    const filtered = filterPreferred(entries, blacklist, {
      score: cfg.scoreThreshold,
      pkgLost: cfg.pkgLostThreshold,
      cap: cfg.maxNodesIp,
    });
    await kv.savePreferredIps(filtered);
    await kv.saveMeta({
      lastFetch: Date.now(),
      lastError: null,
    });
    console.log(`[scraper] stored ${filtered.length} preferred IPs`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[scraper] fetch failed: ${msg}`);
    const prev = await kv.loadMeta();
    await kv.saveMeta({ lastFetch: prev.lastFetch, lastError: msg });
  }
}
