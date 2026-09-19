import type { CfEntry } from "./types.ts";

export type KvMeta = {
  lastFetch: number;
  lastError: string | null;
};

export interface KvStore {
  loadPreferredIps(): Promise<CfEntry[]>;
  savePreferredIps(entries: CfEntry[]): Promise<void>;
  loadPreferredDomains(): Promise<CfEntry[]>;
  savePreferredDomains(entries: CfEntry[]): Promise<void>;
  loadBlacklistIps(): Promise<string[]>;
  saveBlacklistIps(ips: string[]): Promise<void>;
  loadMeta(): Promise<KvMeta>;
  saveMeta(meta: KvMeta): Promise<void>;
}

export class MemoryKv implements KvStore {
  #preferredIps: CfEntry[] = [];
  #preferredDomains: CfEntry[] = [];
  #blacklist: string[] = [];
  #meta: KvMeta = { lastFetch: 0, lastError: null };

  loadPreferredIps(): Promise<CfEntry[]> {
    return Promise.resolve([...this.#preferredIps]);
  }
  savePreferredIps(entries: CfEntry[]): Promise<void> {
    this.#preferredIps = entries;
    return Promise.resolve();
  }
  loadPreferredDomains(): Promise<CfEntry[]> {
    return Promise.resolve([...this.#preferredDomains]);
  }
  savePreferredDomains(entries: CfEntry[]): Promise<void> {
    this.#preferredDomains = entries;
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
