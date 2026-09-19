export type Config = {
  port: number;
  subToken: string;
  vps789Token: string;
  maxNodesIp: number;
  scoreThreshold: number;
  pkgLostThreshold: number;
  kvRefreshCron: string;
};

function requireFinite(name: string, value: number): number {
  if (!Number.isFinite(value)) {
    throw new Error(`${name} env var must be a finite number, got: ${value}`);
  }
  return value;
}

export function loadConfig(): Config {
  const env = Deno.env.toObject();
  const subToken = env.SUB_TOKEN ?? "";
  const vps789Token = env.VPS789_TOKEN ?? "";
  if (!subToken) throw new Error("SUB_TOKEN env var is required");
  if (!vps789Token) throw new Error("VPS789_TOKEN env var is required");
  const port = requireFinite("PORT", Number(env.PORT ?? "8000"));
  const maxNodesIp = requireFinite("MAX_NODES_IP", Number(env.MAX_NODES_IP ?? "20"));
  const scoreThreshold = requireFinite(
    "SCORE_THRESHOLD",
    Number(env.SCORE_THRESHOLD ?? "500"),
  );
  const pkgLostThreshold = requireFinite(
    "PKGLOST_THRESHOLD",
    Number(env.PKGLOST_THRESHOLD ?? "10"),
  );
  const kvRefreshCron = env.KV_REFRESH_CRON ?? "0 * * * *";
  return {
    port,
    subToken,
    vps789Token,
    maxNodesIp,
    scoreThreshold,
    pkgLostThreshold,
    kvRefreshCron,
  };
}
