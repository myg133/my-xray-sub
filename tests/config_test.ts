import { assertEquals, assertThrows } from "jsr:@std/assert@^1.0.0";
import { loadConfig } from "../config.ts";

const baseEnv = {
  SUB_TOKEN: "sub-tok",
  VPS789_TOKEN: "vps789-tok",
  VPS789_YF_TOKEN: "yf-tok",
};

Deno.test("loadConfig: returns defaults when only required env vars set", () => {
  const cfg = loadConfig(baseEnv);
  assertEquals(cfg.vps789YfToken, "yf-tok");
  assertEquals(cfg.maxNodesIp, 20);
  assertEquals(cfg.maxNodesDomain, 20);
  assertEquals(cfg.scoreThreshold, 500);
  assertEquals(cfg.pkgLostThreshold, 10);
  assertEquals(cfg.kvRefreshCron, "0 * * * *");
  assertEquals(cfg.port, 8000);
});

Deno.test("loadConfig: reads VPS789_YF_TOKEN and MAX_NODES_DOMAIN overrides", () => {
  const cfg = loadConfig({
    ...baseEnv,
    MAX_NODES_IP: "30",
    MAX_NODES_DOMAIN: "15",
    PORT: "9000",
  });
  assertEquals(cfg.vps789YfToken, "yf-tok");
  assertEquals(cfg.maxNodesIp, 30);
  assertEquals(cfg.maxNodesDomain, 15);
  assertEquals(cfg.port, 9000);
});

Deno.test("loadConfig: throws when VPS789_YF_TOKEN missing", () => {
  assertThrows(
    () => loadConfig({ SUB_TOKEN: "x", VPS789_TOKEN: "y" }),
    Error,
    "VPS789_YF_TOKEN",
  );
});

Deno.test("loadConfig: throws when VPS789_YF_TOKEN empty", () => {
  assertThrows(
    () => loadConfig({ SUB_TOKEN: "x", VPS789_TOKEN: "y", VPS789_YF_TOKEN: "" }),
    Error,
    "VPS789_YF_TOKEN",
  );
});
