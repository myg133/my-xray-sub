import type { VlessParams } from "./types.ts";

export function buildVlessUri(params: VlessParams, address: string, remark: string): string {
  const query = [
    `encryption=${params.encryption}`,
    `security=${params.security}`,
    `sni=${params.sni}`,
    `alpn=${params.alpn}`,
    `fp=${params.fingerprint}`,
    `type=${params.network}`,
    `host=${params.host}`,
    `path=${encodeURIComponent(params.path)}`,
    `mode=${params.mode}`,
  ].join("&");
  return `vless://${params.id}@${address}:${params.port}?${query}#${encodeURIComponent(remark)}`;
}
