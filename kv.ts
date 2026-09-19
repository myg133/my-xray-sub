import type { CfEntry } from "./types.ts";
import type { KvMeta, KvStore } from "./kv_memory.ts";

export class DenoKv implements KvStore {
  #kv: Deno.Kv;
  static async open(): Promise<DenoKv> {
    const kv = await Deno.openKv();
    return new DenoKv(kv);
  }
  private constructor(kv: Deno.Kv) {
    this.#kv = kv;
  }

  loadPreferredIps(): Promise<CfEntry[]> {
    return this.#kv.get<CfEntry[]>(["preferred", "ips"]).then((r) => r.value ?? []);
  }
  async savePreferredIps(entries: CfEntry[]): Promise<void> {
    await this.#kv.set(["preferred", "ips"], entries);
  }
  loadBlacklistIps(): Promise<string[]> {
    return this.#kv.get<string[]>(["blacklist", "ips"]).then((r) => r.value ?? []);
  }
  async saveBlacklistIps(ips: string[]): Promise<void> {
    await this.#kv.set(["blacklist", "ips"], ips);
  }
  loadMeta(): Promise<KvMeta> {
    return this.#kv
      .get<KvMeta>(["meta"])
      .then((r) => r.value ?? { lastFetch: 0, lastError: null });
  }
  async saveMeta(meta: KvMeta): Promise<void> {
    await this.#kv.set(["meta"], meta);
  }
}
