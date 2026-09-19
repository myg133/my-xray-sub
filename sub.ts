import type { Config } from "./config.ts";
import type { KvStore } from "./kv_memory.ts";
import { buildVlessUri } from "./vless.ts";
import type { CfEntry, SubQuery, VlessParams } from "./types.ts";

export function parseQuery(url: URL): SubQuery | null {
  const group = url.searchParams.get("group");
  const id = url.searchParams.get("id");
  const path = url.searchParams.get("path");
  const host = url.searchParams.get("host");
  if (!group || !id || !path || !host) return null;
  const allowInsecure = url.searchParams.get("allowInsecure") === "true";
  return { group, id, path, host, allowInsecure };
}

function vlessParamsFromQuery(q: SubQuery): VlessParams {
  return {
    id: q.id,
    host: q.host,
    port: 443,
    path: decodeURIComponent(q.path),
    network: "xhttp",
    security: "tls",
    sni: q.host,
    alpn: "h2",
    fingerprint: "chrome",
    encryption: "none",
    mode: "auto",
    allowInsecure: q.allowInsecure,
  };
}

export async function handleSub(req: Request, cfg: Config, kv: KvStore): Promise<Response> {
  if (cfg.requireToken && req.headers.get("X-Sub-Token") !== cfg.subToken) {
    return new Response(null, { status: 404 });
  }
  const url = new URL(req.url);
  const q = parseQuery(url);
  if (!q) {
    return new Response("missing required query params: group, id, path, host", {
      status: 400,
    });
  }

  let ips: CfEntry[], domains: CfEntry[];
  try {
    [ips, domains] = await Promise.all([
      kv.loadPreferredIps(),
      kv.loadPreferredDomains(),
    ]);
  } catch (_err) {
    return new Response("KV unavailable", { status: 503 });
  }
  const params = vlessParamsFromQuery(q);

  const allEntries: CfEntry[] = [...ips, ...domains];
  const uris = allEntries.length > 0
    ? allEntries.map((entry, idx) => {
      const remark = entry.type === "ip"
        ? `${q.group}-${entry.carrierCode ?? "?"}-${Math.round(entry.carrierLatency ?? 0)}-${idx}`
        : `${q.group}-Domain-${entry.avgScore}-${idx}`;
      return buildVlessUri(params, entry.value, remark);
    })
    : [buildVlessUri(params, q.host, `${q.group}-0`)];

  const body = btoa(uris.join("\n"));
  return new Response(body, {
    status: 200,
    headers: { "content-type": "text/plain; charset=utf-8" },
  });
}
