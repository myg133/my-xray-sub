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
  return { group, id, path, host };
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
  };
}

export async function handleSub(req: Request, cfg: Config, kv: KvStore): Promise<Response> {
  if (req.headers.get("X-Sub-Token") !== cfg.subToken) {
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
  const addresses: string[] = allEntries.length > 0 ? allEntries.map((e) => e.value) : [q.host];

  const uris = addresses.map((addr, idx) => buildVlessUri(params, addr, `${q.group}-${idx}`));

  const body = btoa(uris.join("\n"));
  return new Response(body, {
    status: 200,
    headers: { "content-type": "text/plain; charset=utf-8" },
  });
}
