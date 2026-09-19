import { loadConfig } from "./config.ts";
import { DenoKv } from "./kv.ts";
import { handleSub } from "./sub.ts";
import { registerCron } from "./cron.ts";

const cfg = loadConfig();

const kv = await DenoKv.open();
registerCron(cfg, kv);

Deno.serve({ port: cfg.port }, (req) => handleSub(req, cfg, kv));

console.log(`xray-sub listening on http://localhost:${cfg.port}`);
