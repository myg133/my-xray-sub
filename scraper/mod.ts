import type { Config } from "../config.ts";
import type { KvStore } from "../kv_memory.ts";
import { fetchVps789Domains, fetchVps789Ips } from "./vps789.ts";
import { filterPreferred } from "./filter.ts";

export async function fetchAndStore(cfg: Config, kv: KvStore): Promise<void> {
  const [ipResult, domainResult] = await Promise.allSettled([
    fetchVps789Ips(cfg.vps789Token),
    fetchVps789Domains(cfg.vps789YfToken),
  ]);

  const errors: string[] = [];

  if (ipResult.status === "fulfilled") {
    try {
      const blacklist = await kv.loadBlacklistIps();
      const filtered = filterPreferred(ipResult.value, blacklist, {
        score: cfg.scoreThreshold,
        pkgLost: cfg.pkgLostThreshold,
        cap: cfg.maxNodesIp,
      });
      await kv.savePreferredIps(filtered);
      console.log(`[scraper] stored ${filtered.length} preferred IPs`);
    } catch (err) {
      errors.push(`ips: ${err instanceof Error ? err.message : String(err)}`);
    }
  } else {
    const reason = ipResult.reason instanceof Error
      ? ipResult.reason.message
      : String(ipResult.reason);
    errors.push(`ips: ${reason}`);
  }

  if (domainResult.status === "fulfilled") {
    try {
      const filtered = filterPreferred(domainResult.value, [], {
        score: cfg.scoreThreshold,
        pkgLost: cfg.pkgLostThreshold,
        cap: cfg.maxNodesDomain,
      });
      await kv.savePreferredDomains(filtered);
      console.log(`[scraper] stored ${filtered.length} preferred domains`);
    } catch (err) {
      errors.push(`domains: ${err instanceof Error ? err.message : String(err)}`);
    }
  } else {
    const reason = domainResult.reason instanceof Error
      ? domainResult.reason.message
      : String(domainResult.reason);
    errors.push(`domains: ${reason}`);
  }

  const prev = await kv.loadMeta();
  if (errors.length > 0) {
    const msg = errors.join("; ");
    console.error(`[scraper] fetch failed: ${msg}`);
    await kv.saveMeta({ lastFetch: prev.lastFetch, lastError: msg });
  } else {
    await kv.saveMeta({ lastFetch: Date.now(), lastError: null });
  }
}
