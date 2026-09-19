import type { CfEntry } from "../types.ts";

const ENDPOINT = "https://vps789.com/openApi/cfIpApi";

type RawEntry = {
  ip?: string;
  ydLatencyAvg?: number;
  ltLatencyAvg?: number;
  dxLatencyAvg?: number;
  ydPkgLostRateAvg?: number;
  ltPkgLostRateAvg?: number;
  dxPkgLostRateAvg?: number;
  avgScore?: number;
};

function normalize(raw: RawEntry): CfEntry {
  const lats = [raw.ydLatencyAvg, raw.ltLatencyAvg, raw.dxLatencyAvg].filter((v) =>
    typeof v === "number"
  );
  const losses = [
    raw.ydPkgLostRateAvg,
    raw.ltPkgLostRateAvg,
    raw.dxPkgLostRateAvg,
  ].filter((v) => typeof v === "number");
  const avgLatency = lats.length ? lats.reduce((a, b) => a + b, 0) / lats.length : 0;
  const avgPkgLost = losses.length ? losses.reduce((a, b) => a + b, 0) / losses.length : 0;
  return {
    value: raw.ip ?? "",
    type: "ip",
    avgScore: raw.avgScore ?? 0,
    avgLatency,
    avgPkgLost,
  };
}

export async function fetchVps789Ips(token: string): Promise<CfEntry[]> {
  const url = `${ENDPOINT}?token=${encodeURIComponent(token)}`;
  const res = await fetch(url, { headers: { "User-Agent": "xray-sub/1.0" } });
  if (!res.ok) {
    throw new Error(`vps789 fetch failed: HTTP ${res.status}`);
  }
  const json = await res.json();
  if (json.code !== 0) {
    throw new Error(`vps789 returned code=${json.code}: ${json.message}`);
  }
  const data = json.data ?? {};
  const groups: RawEntry[] = [
    ...(data.CT ?? []),
    ...(data.CU ?? []),
    ...(data.CM ?? []),
  ];

  const dedup = new Map<string, CfEntry>();
  for (const raw of groups) {
    if (!raw.ip) continue;
    const e = normalize(raw);
    const cur = dedup.get(e.value);
    if (!cur || e.avgScore < cur.avgScore) dedup.set(e.value, e);
  }
  return [...dedup.values()];
}
