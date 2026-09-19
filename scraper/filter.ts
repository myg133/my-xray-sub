import type { CfEntry } from "../types.ts";

export type FilterOptions = {
  score: number;
  pkgLost: number;
  cap: number;
};

export function filterPreferred(
  entries: CfEntry[],
  blacklist: string[],
  opts: FilterOptions,
): CfEntry[] {
  const bl = new Set(blacklist);

  const dedup = new Map<string, CfEntry>();
  for (const e of entries) {
    if (e.avgScore > opts.score) continue;
    if (e.avgPkgLost > opts.pkgLost) continue;
    if (bl.has(e.value)) continue;
    const cur = dedup.get(e.value);
    if (!cur || e.avgScore < cur.avgScore) dedup.set(e.value, e);
  }

  const arr = [...dedup.values()];

  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }

  return arr.slice(0, opts.cap);
}
