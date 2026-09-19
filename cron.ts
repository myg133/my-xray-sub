import type { Config } from "./config.ts";
import type { KvStore } from "./kv_memory.ts";
import { fetchAndStore } from "./scraper/mod.ts";

export function registerCron(cfg: Config, kv: KvStore): void {
  Deno.cron("refresh-cf-ips", cfg.kvRefreshCron, async () => {
    console.log("[cron] tick");
    await fetchAndStore(cfg, kv);
  });
}
