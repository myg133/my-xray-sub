import { loadConfig } from "./config.ts";

const cfg = loadConfig();

Deno.serve({ port: cfg.port }, () => new Response("hello", { status: 200 }));

console.log(`xray-sub listening on http://localhost:${cfg.port}`);
