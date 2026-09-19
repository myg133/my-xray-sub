import type { CfEntry } from "./types.ts";

export type KvMeta = {
  lastFetch: number;
  lastError: string | null;
};

export interface KvStore {
  loadPreferredIps(): Promise<CfEntry[]>;
  savePreferredIps(entries: CfEntry[]): Promise<void>;
  loadBlacklistIps(): Promise<string[]>;
  saveBlacklistIps(ips: string[]): Promise<void>;
  loadMeta(): Promise<KvMeta>;
  saveMeta(meta: KvMeta): Promise<void>;
}

export class MemoryKv implements KvStore {
  #preferred: CfEntry[] = [];
  #blacklist: string[] = [];
  #meta: KvMeta = { lastFetch: 0, lastError: null };

  loadPreferredIps(): Promise<CfEntry[]> {
    return Promise.resolve([...this.#preferred]);
  }
  savePreferredIps(entries: CfEntry[]): Promise<void> {
    this.#preferred = entries;
    return Promise.resolve();
  }
  loadBlacklistIps(): Promise<string[]> {
    return Promise.resolve([...this.#blacklist]);
  }
  saveBlacklistIps(ips: string[]): Promise<void> {
    this.#blacklist = ips;
    return Promise.resolve();
  }
  loadMeta(): Promise<KvMeta> {
    return Promise.resolve({ ...this.#meta });
  }
  saveMeta(meta: KvMeta): Promise<void> {
    this.#meta = meta;
    return Promise.resolve();
  }
}
