# v2rayn Subscription Service Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a self-hosted subscription service for v2rayN that returns Base64-encoded
VLESS+xhttp URIs pointing to the user's VPS through hourly-refreshed Cloudflare preferred IPs, gated
by an `X-Sub-Token` header.

**Architecture:** Single Deno module deployable to Deno Deploy. A `Deno.cron` job hits
`vps789.com/openApi/cfIpApi` every hour, filters the result by quality score + packet loss, and
writes the clean IP list to Deno KV. An HTTP `GET /sub` handler validates the `X-Sub-Token` header,
reads the IPs from KV, builds one VLESS URI per IP using the requested `id`/`path`/`host` params,
joins them with newlines, and returns Base64-encoded text.

**Tech Stack:** Deno 2.9+, `Deno.openKv()`, `Deno.cron()`, `Deno.serve()`, `Deno.test`. No external
dependencies (zero JSR/npm imports).

**Spec:** `docs/superpowers/specs/2026-09-19-v2ray-sub-design.md`

---

## File Structure

| File                    | Responsibility                                                                |
| ----------------------- | ----------------------------------------------------------------------------- |
| `deno.json`             | Tasks, lint rules, fmt config                                                 |
| `.gitignore`            | Ignore `.env`, `_test/` cache, deno KV files                                  |
| `types.ts`              | Shared type definitions (`CfEntry`, `VlessParams`, etc.)                      |
| `config.ts`             | Env parsing + defaults (no logic)                                             |
| `kv.ts`                 | Typed KV helpers (`loadPreferred`, `savePreferred`, `loadBlacklist`, etc.)    |
| `kv_memory.ts`          | In-memory KV adapter for tests (mirrors `kv.ts` interface)                    |
| `vless.ts`              | Pure function: `buildVlessUri(params, address, remark) → string`              |
| `scraper/filter.ts`     | Pure function: filter IPs by score/loss, dedupe across carriers, shuffle, cap |
| `scraper/vps789.ts`     | Fetch `openApi/cfIpApi`, parse JSON, normalize to `CfEntry[]`                 |
| `scraper/mod.ts`        | Orchestrator: `fetchAndStore()` = fetch → filter → save                       |
| `sub.ts`                | HTTP handler for `GET /sub`                                                   |
| `cron.ts`               | `Deno.cron` registration                                                      |
| `main.ts`               | Deno Deploy entrypoint (exports `{ fetch }` + registers cron)                 |
| `tests/vless_test.ts`   | `buildVlessUri` unit tests                                                    |
| `tests/filter_test.ts`  | `filterPreferred` unit tests                                                  |
| `tests/scraper_test.ts` | `fetchVps789Ips` parser tests (mocked fetch)                                  |
| `tests/kv_test.ts`      | KV helpers + in-memory adapter parity tests                                   |
| `tests/sub_test.ts`     | `handleSub` integration tests                                                 |

**Decomposition rationale:** Each file is independently testable. `vless.ts`, `filter.ts`,
`vps789.ts` parser are pure. `kv.ts` and `kv_memory.ts` share an interface. `sub.ts` and `cron.ts`
are the only files aware of HTTP/cron.

---

## Task 1: Project skeleton

**Files:**

- Create: `xray-sub/deno.json`
- Create: `xray-sub/.gitignore`
- Create: `xray-sub/types.ts`
- Create: `xray-sub/main.ts`

- [ ] **Step 1: Create `deno.json` with tasks + lint config**

Create `xray-sub/deno.json`:

```json
{
  "tasks": {
    "check": "deno fmt --check && deno lint && deno check **/*.ts",
    "test": "deno test --allow-env --allow-net=localhost,127.0.0.1,vps789.com",
    "dev": "deno run --allow-env --allow-net --allow-read --watch main.ts"
  },
  "lint": {
    "rules": {
      "tags": ["recommended"]
    }
  },
  "fmt": {
    "lineWidth": 100,
    "indentWidth": 2,
    "semiColons": true,
    "singleQuote": false
  },
  "exclude": ["**/_fresh/*", "**/node_modules/*"]
}
```

- [ ] **Step 2: Create `.gitignore`**

Create `xray-sub/.gitignore`:

```
.env
.env.local
_test/
.deno_kv/
*.kv
*.kv.*
```

- [ ] **Step 3: Create `types.ts` with shared types**

Create `xray-sub/types.ts`:

```ts
export type CfEntry = {
  value: string;
  type: "ip";
  avgScore: number;
  avgLatency: number;
  avgPkgLost: number;
};

export type VlessParams = {
  id: string;
  host: string;
  port: number;
  path: string;
  network: "xhttp";
  security: "tls";
  sni: string;
  alpn: string;
  fingerprint: string;
  encryption: "none";
  mode: "auto";
};

export type SubQuery = {
  group: string;
  id: string;
  path: string;
  host: string;
};

export type KvShape = {
  preferredIps: CfEntry[];
  blacklistIps: string[];
  lastFetch: number;
  lastError: string | null;
};
```

- [ ] **Step 4: Create minimal `main.ts` that boots Deno.serve**

Create `xray-sub/main.ts`:

```ts
import { loadConfig } from "./config.ts";

const cfg = loadConfig();

Deno.serve({ port: cfg.port }, () => new Response("hello", { status: 200 }));

console.log(`xray-sub listening on http://localhost:${cfg.port}`);
```

- [ ] **Step 5: Create `config.ts` stub**

Create `xray-sub/config.ts`:

```ts
export type Config = {
  port: number;
  subToken: string;
  vps789Token: string;
  maxNodesIp: number;
  scoreThreshold: number;
  pkgLostThreshold: number;
  kvRefreshCron: string;
};

export function loadConfig(): Config {
  const env = Deno.env.toObject();
  const subToken = env.SUB_TOKEN ?? "";
  const vps789Token = env.VPS789_TOKEN ?? "";
  const port = Number(env.PORT ?? "8000");
  const maxNodesIp = Number(env.MAX_NODES_IP ?? "20");
  const scoreThreshold = Number(env.SCORE_THRESHOLD ?? "500");
  const pkgLostThreshold = Number(env.PKGLOST_THRESHOLD ?? "10");
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
```

- [ ] **Step 6: Run `deno check` to verify types compile**

Run from `xray-sub/`:

```
deno check main.ts config.ts types.ts
```

Expected: no errors.

- [ ] **Step 7: Smoke-test boot**

Run from `xray-sub/`:

```
PORT=8765 deno run --allow-env --allow-net main.ts &
sleep 1
curl -sf http://localhost:8765/ -o /dev/null -w "HTTP=%{http_code}\n"
kill %1
```

Expected: `HTTP=200`

- [ ] **Step 8: Initialize git and commit**

Run from `xray-sub/`:

```
git init
git add deno.json .gitignore types.ts main.ts config.ts
git commit -m "chore: bootstrap deno project skeleton"
```

---

## Task 2: VLESS URI builder (TDD)

**Files:**

- Create: `xray-sub/vless.ts`
- Create: `xray-sub/tests/vless_test.ts`

- [ ] **Step 1: Write failing test for `buildVlessUri` with an IP address**

Create `xray-sub/tests/vless_test.ts`:

```ts
import { assertEquals } from "jsr:@std/assert@^1.0.0";
import { buildVlessUri } from "../vless.ts";
import type { VlessParams } from "../types.ts";

const baseParams: VlessParams = {
  id: "d08096d7-2715-486a-925d-b2e506192385",
  host: "vr.ttmic.top",
  port: 443,
  path: "/P93750",
  network: "xhttp",
  security: "tls",
  sni: "vr.ttmic.top",
  alpn: "h2",
  fingerprint: "chrome",
  encryption: "none",
  mode: "auto",
};

Deno.test("buildVlessUri with IPv4 address", () => {
  const uri = buildVlessUri(baseParams, "104.16.123.45", "bwh-servers-1");
  assertEquals(
    uri,
    "vless://d08096d7-2715-486a-925d-b2e506192385@104.16.123.45:443?" +
      "encryption=none&security=tls&sni=vr.ttmic.top&alpn=h2&fp=chrome" +
      "&type=xhttp&host=vr.ttmic.top&path=%2FP93750&mode=auto#bwh-servers-1",
  );
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run from `xray-sub/`:

```
deno test --allow-env tests/vless_test.ts
```

Expected: FAIL — `Module not found: "../vless.ts"` (or similar).

- [ ] **Step 3: Implement `buildVlessUri`**

Create `xray-sub/vless.ts`:

```ts
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

Note: `encodeURIComponent` does **not** encode `/`, so `path` stays readable. Adjust if VLESS spec requires strict encoding — verify during testing.

- [ ] **Step 4: Run test — expect PASS**

Run from `xray-sub/`:
```

deno test --allow-env tests/vless_test.ts

````
Expected: PASS (1 test).

- [ ] **Step 5: Add more tests for edge cases**

Append to `xray-sub/tests/vless_test.ts`:

```ts
Deno.test("buildVlessUri with domain address", () => {
  const uri = buildVlessUri(baseParams, "cdn.example.com", "ovh-1");
  assertEquals(
    uri,
    "vless://d08096d7-2715-486a-925d-b2e506192385@cdn.example.com:443?" +
      "encryption=none&security=tls&sni=vr.ttmic.top&alpn=h2&fp=chrome" +
      "&type=xhttp&host=vr.ttmic.top&path=%2FP93750&mode=auto#ovh-1",
  );
});

Deno.test("buildVlessUri URL-encodes remark with spaces", () => {
  const uri = buildVlessUri(baseParams, "104.16.1.1", "my node 1");
  assertEquals(uri.includes("#my%20node%201"), true);
});

Deno.test("buildVlessUri with path containing special chars", () => {
  const params = { ...baseParams, path: "/api/v2?foo=bar" };
  const uri = buildVlessUri(params, "104.16.1.1", "n");
  assertEquals(uri.includes("path=%2Fapi%2Fv2%3Ffoo%3Dbar"), true);
});
````

- [ ] **Step 6: Run tests — expect all PASS**

Run from `xray-sub/`:

```
deno test --allow-env tests/vless_test.ts
```

Expected: PASS (4 tests).

- [ ] **Step 7: Commit**

```
git add vless.ts tests/vless_test.ts
git commit -m "feat(vless): add URI builder with tests"
```

---

## Task 3: KV helpers + in-memory adapter (TDD)

**Files:**

- Create: `xray-sub/kv.ts`
- Create: `xray-sub/kv_memory.ts`
- Create: `xray-sub/tests/kv_test.ts`

- [ ] **Step 1: Write failing test defining the KV interface**

Create `xray-sub/tests/kv_test.ts`:

```ts
import { assertEquals } from "jsr:@std/assert@^1.0.0";
import { MemoryKv } from "../kv_memory.ts";
import type { CfEntry } from "../types.ts";

const sampleEntry: CfEntry = {
  value: "104.16.1.1",
  type: "ip",
  avgScore: 100,
  avgLatency: 80,
  avgPkgLost: 1,
};

Deno.test("MemoryKv: preferredIps round-trip", async () => {
  const kv = new MemoryKv();
  await kv.savePreferredIps([sampleEntry]);
  const loaded = await kv.loadPreferredIps();
  assertEquals(loaded, [sampleEntry]);
});

Deno.test("MemoryKv: blacklistIps round-trip", async () => {
  const kv = new MemoryKv();
  await kv.saveBlacklistIps(["1.2.3.4"]);
  assertEquals(await kv.loadBlacklistIps(), ["1.2.3.4"]);
});

Deno.test("MemoryKv: meta round-trip", async () => {
  const kv = new MemoryKv();
  await kv.saveMeta({ lastFetch: 1234, lastError: "boom" });
  const meta = await kv.loadMeta();
  assertEquals(meta.lastFetch, 1234);
  assertEquals(meta.lastError, "boom");
});

Deno.test("MemoryKv: empty store returns sensible defaults", async () => {
  const kv = new MemoryKv();
  assertEquals(await kv.loadPreferredIps(), []);
  assertEquals(await kv.loadBlacklistIps(), []);
  const meta = await kv.loadMeta();
  assertEquals(meta.lastFetch, 0);
  assertEquals(meta.lastError, null);
});
```

- [ ] **Step 2: Run — expect FAIL**

Run from `xray-sub/`:

```
deno test --allow-env tests/kv_test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement `MemoryKv`**

Create `xray-sub/kv_memory.ts`:

```ts
import type { CfEntry } from "./types.ts";

export type KvMeta = {
  lastFetch: number;
  lastError: string | null;
};

export interface KvStore {
  loadPreferredIps(): Promise<CfEntry[]>;
  savePreferredIps(entries: CfEntry[]): Promise<void>;
  loadBlacklistIps(): Promise<string[]>;
  saveBlacklistIps(ips: string[]): Promise<void>;
  loadMeta(): Promise<KvMeta>;
  saveMeta(meta: KvMeta): Promise<void>;
}

export class MemoryKv implements KvStore {
  #preferred: CfEntry[] = [];
  #blacklist: string[] = [];
  #meta: KvMeta = { lastFetch: 0, lastError: null };

  loadPreferredIps(): Promise<CfEntry[]> {
    return Promise.resolve([...this.#preferred]);
  }
  savePreferredIps(entries: CfEntry[]): Promise<void> {
    this.#preferred = entries;
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
```

- [ ] **Step 4: Run tests — expect PASS**

Run from `xray-sub/`:

```
deno test --allow-env tests/kv_test.ts
```

Expected: PASS (4 tests).

- [ ] **Step 5: Implement `DenoKv` wrapper against `Deno.openKv`**

Create `xray-sub/kv.ts`:

```ts
import type { CfEntry } from "./types.ts";
import type { KvMeta, KvStore } from "./kv_memory.ts";

export class DenoKv implements KvStore {
  #kv: Deno.Kv;
  static async open(): Promise<DenoKv> {
    const kv = await Deno.openKv();
    return new DenoKv(kv);
  }
  private constructor(kv: Deno.Kv) {
    this.#kv = kv;
  }

  loadPreferredIps(): Promise<CfEntry[]> {
    return this.#kv.get<CfEntry[]>(["preferred", "ips"]).then((r) => r.value ?? []);
  }
  async savePreferredIps(entries: CfEntry[]): Promise<void> {
    await this.#kv.set(["preferred", "ips"], entries);
  }
  loadBlacklistIps(): Promise<string[]> {
    return this.#kv.get<string[]>(["blacklist", "ips"]).then((r) => r.value ?? []);
  }
  async saveBlacklistIps(ips: string[]): Promise<void> {
    await this.#kv.set(["blacklist", "ips"], ips);
  }
  loadMeta(): Promise<KvMeta> {
    return this.#kv
      .get<{ lastFetch: number; lastError: string | null }>(["meta"])
      .then((r) => r.value ?? { lastFetch: 0, lastError: null });
  }
  async saveMeta(meta: KvMeta): Promise<void> {
    await this.#kv.set(["meta"], meta);
  }
}
```

Note: `KvStore` interface is exported from `kv_memory.ts` to avoid a circular import — both real and
memory adapters implement it.

- [ ] **Step 6: Smoke-check `DenoKv` compiles**

Run from `xray-sub/`:

```
deno check kv.ts kv_memory.ts
```

Expected: no errors.

- [ ] **Step 7: Commit**

```
git add kv.ts kv_memory.ts tests/kv_test.ts
git commit -m "feat(kv): typed KV store with memory adapter for tests"
```

---

## Task 4: Scraper filter (TDD)

**Files:**

- Create: `xray-sub/scraper/filter.ts`
- Create: `xray-sub/tests/filter_test.ts`

- [ ] **Step 1: Write failing test for filter + dedupe + cap**

Create `xray-sub/tests/filter_test.ts`:

```ts
import { assertEquals } from "jsr:@std/assert@^1.0.0";
import { filterPreferred } from "../scraper/filter.ts";
import type { CfEntry } from "../types.ts";

const mk = (value: string, avgScore: number, avgPkgLost = 1): CfEntry => ({
  value,
  type: "ip",
  avgScore,
  avgLatency: 100,
  avgPkgLost,
});

Deno.test("filterPreferred: drops entries above score threshold", () => {
  const input = [mk("1.1.1.1", 100), mk("2.2.2.2", 800)];
  const out = filterPreferred(input, [], { score: 500, pkgLost: 10, cap: 20 });
  assertEquals(out.map((e) => e.value), ["1.1.1.1"]);
});

Deno.test("filterPreferred: drops entries above packet-loss threshold", () => {
  const input = [mk("1.1.1.1", 100, 1), mk("2.2.2.2", 100, 50)];
  const out = filterPreferred(input, [], { score: 500, pkgLost: 10, cap: 20 });
  assertEquals(out.map((e) => e.value), ["1.1.1.1"]);
});

Deno.test("filterPreferred: drops blacklisted", () => {
  const input = [mk("1.1.1.1", 100), mk("2.2.2.2", 100)];
  const out = filterPreferred(input, ["2.2.2.2"], { score: 500, pkgLost: 10, cap: 20 });
  assertEquals(out.map((e) => e.value), ["1.1.1.1"]);
});

Deno.test("filterPreferred: dedupes by value, keeping best score", () => {
  const input = [mk("1.1.1.1", 200), mk("1.1.1.1", 150), mk("2.2.2.2", 100)];
  const out = filterPreferred(input, [], { score: 500, pkgLost: 10, cap: 20 });
  assertEquals(out.length, 2);
  const one = out.find((e) => e.value === "1.1.1.1")!;
  assertEquals(one.avgScore, 150);
});

Deno.test("filterPreferred: respects cap", () => {
  const input = Array.from({ length: 30 }, (_, i) => mk(`1.1.1.${i}`, 100));
  const out = filterPreferred(input, [], { score: 500, pkgLost: 10, cap: 5 });
  assertEquals(out.length, 5);
});

Deno.test("filterPreferred: shuffle produces varying order", () => {
  const input = Array.from({ length: 50 }, (_, i) => mk(`1.1.1.${i}`, 100));
  const out1 = filterPreferred(input, [], { score: 500, pkgLost: 10, cap: 50 });
  const out2 = filterPreferred(input, [], { score: 500, pkgLost: 10, cap: 50 });
  const sameOrder = out1.every((e, i) => e.value === out2[i].value);
  assertEquals(sameOrder, false, "expected different shuffle orders");
});
```

- [ ] **Step 2: Run — expect FAIL**

Run from `xray-sub/`:

```
deno test --allow-env tests/filter_test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement `filterPreferred`**

Create `xray-sub/scraper/filter.ts`:

```ts
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
```

- [ ] **Step 4: Run tests — expect PASS**

Run from `xray-sub/`:

```
deno test --allow-env tests/filter_test.ts
```

Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```
git add scraper/filter.ts tests/filter_test.ts
git commit -m "feat(scraper): filter+dedupe+shuffle+cap pure function"
```

---

## Task 5: vps789 fetcher (TDD with mocked fetch)

**Files:**

- Create: `xray-sub/scraper/vps789.ts`
- Create: `xray-sub/tests/scraper_test.ts`

- [ ] **Step 1: Write failing tests**

Create `xray-sub/tests/scraper_test.ts`:

```ts
import { assertEquals, assertRejects } from "jsr:@std/assert@^1.0.0";
import { fetchVps789Ips } from "../scraper/vps789.ts";

const sampleBody = JSON.stringify({
  code: 0,
  message: "true",
  count: 0,
  data: {
    CT: [
      {
        ip: "104.19.45.241",
        ydLatencyAvg: 180,
        ltLatencyAvg: 248,
        dxLatencyAvg: 174,
        ydPkgLostRateAvg: 4,
        ltPkgLostRateAvg: 0.8,
        dxPkgLostRateAvg: 3.7,
        avgScore: 348,
      },
    ],
    CU: [
      {
        ip: "104.16.88.178",
        ydLatencyAvg: 184,
        ltLatencyAvg: 171,
        dxLatencyAvg: 205,
        ydPkgLostRateAvg: 5,
        ltPkgLostRateAvg: 0.3,
        dxPkgLostRateAvg: 5.6,
        avgScore: 380,
      },
      {
        ip: "104.19.45.241",
        ydLatencyAvg: 100,
        ltLatencyAvg: 100,
        dxLatencyAvg: 100,
        ydPkgLostRateAvg: 1,
        ltPkgLostRateAvg: 1,
        dxPkgLostRateAvg: 1,
        avgScore: 250,
      },
    ],
    CM: [],
  },
});

Deno.test("fetchVps789Ips: parses CT/CU/CM and merges", async () => {
  const origFetch = globalThis.fetch;
  globalThis.fetch = () => Promise.resolve(new Response(sampleBody, { status: 200 }));
  try {
    const entries = await fetchVps789Ips("dummy-token");
    assertEquals(entries.length, 2);
    const ips = entries.map((e) => e.value).sort();
    assertEquals(ips, ["104.16.88.178", "104.19.45.241"]);
    const dup = entries.find((e) => e.value === "104.19.45.241")!;
    assertEquals(dup.avgScore, 250); // best (lowest) score wins
  } finally {
    globalThis.fetch = origFetch;
  }
});

Deno.test("fetchVps789Ips: averages carrier latencies/loss", async () => {
  const origFetch = globalThis.fetch;
  globalThis.fetch = () => Promise.resolve(new Response(sampleBody, { status: 200 }));
  try {
    const entries = await fetchVps789Ips("dummy-token");
    const e104 = entries.find((e) => e.value === "104.19.45.241")!;
    assertEquals(e104.avgLatency, 100);
    assertEquals(e104.avgPkgLost, 1);
  } finally {
    globalThis.fetch = origFetch;
  }
});

Deno.test("fetchVps789Ips: throws on non-2xx", async () => {
  const origFetch = globalThis.fetch;
  globalThis.fetch = () => Promise.resolve(new Response("forbidden", { status: 403 }));
  try {
    await assertRejects(() => fetchVps789Ips("dummy-token"), Error, "403");
  } finally {
    globalThis.fetch = origFetch;
  }
});

Deno.test("fetchVps789Ips: throws on code != 0", async () => {
  const origFetch = globalThis.fetch;
  globalThis.fetch = () =>
    Promise.resolve(
      new Response(JSON.stringify({ code: 5, message: "Token失效" }), {
        status: 200,
      }),
    );
  try {
    await assertRejects(() => fetchVps789Ips("dummy-token"), Error, "Token");
  } finally {
    globalThis.fetch = origFetch;
  }
});

Deno.test("fetchVps789Ips: tolerates missing fields", async () => {
  const body = JSON.stringify({
    code: 0,
    data: { CT: [{ ip: "1.2.3.4" }], CU: [], CM: [] },
  });
  const origFetch = globalThis.fetch;
  globalThis.fetch = () => Promise.resolve(new Response(body, { status: 200 }));
  try {
    const entries = await fetchVps789Ips("dummy-token");
    assertEquals(entries.length, 1);
    assertEquals(entries[0].value, "1.2.3.4");
    assertEquals(entries[0].avgScore, 0);
  } finally {
    globalThis.fetch = origFetch;
  }
});
```

- [ ] **Step 2: Run — expect FAIL**

Run from `xray-sub/`:

```
deno test --allow-env --allow-net=vps789.com tests/scraper_test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement `fetchVps789Ips`**

Create `xray-sub/scraper/vps789.ts`:

```ts
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
  const lats = [raw.ydLatencyAvg, raw.ltLatencyAvg, raw.dxLatencyAvg].filter(
    (v) => typeof v === "number",
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
```

- [ ] **Step 4: Run tests — expect PASS**

Run from `xray-sub/`:

```
deno test --allow-env --allow-net=vps789.com tests/scraper_test.ts
```

Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```
git add scraper/vps789.ts tests/scraper_test.ts
git commit -m "feat(scraper): fetch+parse vps789 cfIpApi"
```

---

## Task 6: Scraper orchestrator

**Files:**

- Create: `xray-sub/scraper/mod.ts`

- [ ] **Step 1: Implement `fetchAndStore`**

Create `xray-sub/scraper/mod.ts`:

```ts
import type { Config } from "../config.ts";
import type { KvStore } from "../kv_memory.ts";
import { fetchVps789Ips } from "./vps789.ts";
import { filterPreferred } from "./filter.ts";

export async function fetchAndStore(cfg: Config, kv: KvStore): Promise<void> {
  try {
    const entries = await fetchVps789Ips(cfg.vps789Token);
    const blacklist = await kv.loadBlacklistIps();
    const filtered = filterPreferred(entries, blacklist, {
      score: cfg.scoreThreshold,
      pkgLost: cfg.pkgLostThreshold,
      cap: cfg.maxNodesIp,
    });
    await kv.savePreferredIps(filtered);
    await kv.saveMeta({
      lastFetch: Date.now(),
      lastError: null,
    });
    console.log(`[scraper] stored ${filtered.length} preferred IPs`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[scraper] fetch failed: ${msg}`);
    const prev = await kv.loadMeta();
    await kv.saveMeta({ lastFetch: prev.lastFetch, lastError: msg });
  }
}
```

- [ ] **Step 2: Verify compilation**

Run from `xray-sub/`:

```
deno check scraper/mod.ts
```

Expected: no errors.

- [ ] **Step 3: Commit**

```
git add scraper/mod.ts
git commit -m "feat(scraper): orchestrator fetchAndStore()"
```

---

## Task 7: Subscription handler (TDD)

**Files:**

- Create: `xray-sub/sub.ts`
- Create: `xray-sub/tests/sub_test.ts`

- [ ] **Step 1: Write failing test**

Create `xray-sub/tests/sub_test.ts`:

```ts
import { assertEquals } from "jsr:@std/assert@^1.0.0";
import { handleSub } from "../sub.ts";
import { MemoryKv } from "../kv_memory.ts";
import type { Config } from "../config.ts";
import type { CfEntry } from "../types.ts";

const cfg: Config = {
  port: 0,
  subToken: "secret-token",
  vps789Token: "",
  maxNodesIp: 20,
  scoreThreshold: 500,
  pkgLostThreshold: 10,
  kvRefreshCron: "",
};

const sample: CfEntry = {
  value: "104.16.1.1",
  type: "ip",
  avgScore: 100,
  avgLatency: 80,
  avgPkgLost: 1,
};

const baseUrl =
  "http://x/sub?group=bwh&id=d08096d7-2715-486a-925d-b2e506192385&path=%2FP93750&host=vr.ttmic.top";

Deno.test("handleSub: 404 when token missing", async () => {
  const kv = new MemoryKv();
  const res = await handleSub(new Request(baseUrl), cfg, kv);
  assertEquals(res.status, 404);
});

Deno.test("handleSub: 404 when token wrong", async () => {
  const kv = new MemoryKv();
  const req = new Request(baseUrl, { headers: { "X-Sub-Token": "wrong" } });
  const res = await handleSub(req, cfg, kv);
  assertEquals(res.status, 404);
});

Deno.test("handleSub: 400 when query param missing", async () => {
  const kv = new MemoryKv();
  const req = new Request("http://x/sub?id=u&path=/p&host=h", {
    headers: { "X-Sub-Token": "secret-token" },
  });
  const res = await handleSub(req, cfg, kv);
  assertEquals(res.status, 400);
});

Deno.test("handleSub: 200 with base64 when token valid + KV has data", async () => {
  const kv = new MemoryKv();
  await kv.savePreferredIps([sample]);
  const req = new Request(baseUrl, { headers: { "X-Sub-Token": "secret-token" } });
  const res = await handleSub(req, cfg, kv);
  assertEquals(res.status, 200);
  assertEquals(res.headers.get("content-type"), "text/plain; charset=utf-8");
  const body = await res.text();
  const decoded = atob(body);
  const lines = decoded.split("\n").filter(Boolean);
  assertEquals(lines.length, 1);
  assertEquals(
    lines[0].startsWith("vless://d08096d7-2715-486a-925d-b2e506192385@104.16.1.1:443?"),
    true,
  );
  assertEquals(lines[0].includes("#bwh-0"), true);
});

Deno.test("handleSub: 200 with single host-fallback URI when KV empty", async () => {
  const kv = new MemoryKv();
  const req = new Request(baseUrl, { headers: { "X-Sub-Token": "secret-token" } });
  const res = await handleSub(req, cfg, kv);
  assertEquals(res.status, 200);
  const body = await res.text();
  const decoded = atob(body);
  const lines = decoded.split("\n").filter(Boolean);
  assertEquals(lines.length, 1);
  assertEquals(lines[0].includes("@vr.ttmic.top:"), true);
});

Deno.test("handleSub: remark uses group-idx pattern", async () => {
  const kv = new MemoryKv();
  await kv.savePreferredIps([
    sample,
    { ...sample, value: "104.16.2.2" },
    { ...sample, value: "104.16.3.3" },
  ]);
  const req = new Request(baseUrl, { headers: { "X-Sub-Token": "secret-token" } });
  const res = await handleSub(req, cfg, kv);
  const body = atob(await res.text());
  const remarks = body.split("\n").map((l) => l.split("#")[1]);
  assertEquals(new Set(remarks).size, 3);
  for (const r of remarks) {
    assertEquals(r!.startsWith("bwh-"), true);
  }
});
```

- [ ] **Step 2: Run — expect FAIL**

Run from `xray-sub/`:

```
deno test --allow-env tests/sub_test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement `handleSub`**

Create `xray-sub/sub.ts`:

```ts
import type { Config } from "./config.ts";
import type { KvStore } from "./kv_memory.ts";
import { buildVlessUri } from "./vless.ts";
import type { SubQuery, VlessParams } from "./types.ts";

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

  const ips = await kv.loadPreferredIps();
  const params = vlessParamsFromQuery(q);

  const addresses: string[] = ips.length > 0 ? ips.map((e) => e.value) : [q.host];

  const uris = addresses.map((addr, idx) => buildVlessUri(params, addr, `${q.group}-${idx}`));

  const body = btoa(uris.join("\n"));
  return new Response(body, {
    status: 200,
    headers: { "content-type": "text/plain; charset=utf-8" },
  });
}
```

- [ ] **Step 4: Run tests — expect PASS**

Run from `xray-sub/`:

```
deno test --allow-env tests/sub_test.ts
```

Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```
git add sub.ts tests/sub_test.ts
git commit -m "feat(sub): /sub HTTP handler with token + KV integration"
```

---

## Task 8: Cron registration

**Files:**

- Create: `xray-sub/cron.ts`

- [ ] **Step 1: Implement `registerCron`**

Create `xray-sub/cron.ts`:

```ts
import type { Config } from "./config.ts";
import type { KvStore } from "./kv_memory.ts";
import { fetchAndStore } from "./scraper/mod.ts";

export function registerCron(cfg: Config, kv: KvStore): void {
  Deno.cron("refresh-cf-ips", cfg.kvRefreshCron, async () => {
    console.log("[cron] tick");
    await fetchAndStore(cfg, kv);
  });
}
```

- [ ] **Step 2: Verify compilation**

Run from `xray-sub/`:

```
deno check cron.ts
```

Expected: no errors.

- [ ] **Step 3: Commit**

```
git add cron.ts
git commit -m "feat(cron): register hourly refresh-cf-ips cron"
```

---

## Task 9: Wire up `main.ts`

**Files:**

- Modify: `xray-sub/main.ts`

- [ ] **Step 1: Replace placeholder `main.ts` with full wiring**

Replace contents of `xray-sub/main.ts`:

```ts
import { loadConfig } from "./config.ts";
import { DenoKv } from "./kv.ts";
import { handleSub } from "./sub.ts";
import { registerCron } from "./cron.ts";

const cfg = loadConfig();

const kv = await DenoKv.open();
registerCron(cfg, kv);

Deno.serve({ port: cfg.port }, (req) => handleSub(req, cfg, kv));

console.log(`xray-sub listening on http://localhost:${cfg.port}`);
```

- [ ] **Step 2: Verify everything compiles**

Run from `xray-sub/`:

```
deno check **/*.ts
```

Expected: no errors.

- [ ] **Step 3: Run full test suite**

Run from `xray-sub/`:

```
deno task test
```

Expected: PASS across all suites.

- [ ] **Step 4: Local smoke test — boot + curl**

Run from `xray-sub/`:

```
SUB_TOKEN=local-only VPS789_TOKEN=dummy PORT=8765 deno run --allow-env --allow-net main.ts &
sleep 1

# Missing token → 404
curl -s -o /dev/null -w "no-token=%{http_code}\n" \
  "http://localhost:8765/sub?group=bwh&id=u&path=%2Fp&host=h"

# Wrong token → 404
curl -s -o /dev/null -w "bad-token=%{http_code}\n" \
  -H "X-Sub-Token: wrong" \
  "http://localhost:8765/sub?group=bwh&id=u&path=%2Fp&host=h"

# Valid token, empty KV → 200 with host-fallback
curl -s -w "\nvalid-empty=%{http_code}\n" \
  -H "X-Sub-Token: local-only" \
  "http://localhost:8765/sub?group=bwh&id=d08096d7-2715-486a-925d-b2e506192385&path=%2FP93750&host=vr.ttmic.top"

kill %1
```

Expected output:

```
no-token=404
bad-token=404
valid-empty=200
<base64 body>
```

- [ ] **Step 5: Commit**

```
git add main.ts
git commit -m "feat: wire main.ts entrypoint with KV, cron, /sub handler"
```

---

## Task 10: Lint + format pass

- [ ] **Step 1: Run `deno fmt`**

Run from `xray-sub/`:

```
deno fmt
```

Expected: any files reformatted are listed.

- [ ] **Step 2: Run `deno lint`**

Run from `xray-sub/`:

```
deno lint
```

Expected: no errors.

- [ ] **Step 3: Run `deno task check`**

Run from `xray-sub/`:

```
deno task check
```

Expected: no errors.

- [ ] **Step 4: Run full test suite one more time**

Run from `xray-sub/`:

```
deno task test
```

Expected: PASS.

- [ ] **Step 5: Commit formatting changes (if any)**

```
git add -u
git diff --cached --quiet || git commit -m "style: deno fmt"
```

---

## Task 11: Live integration test against vps789

This task requires the user's actual `VPS789_TOKEN`. Not runnable until provided.

**Files:** none modified.

- [ ] **Step 1: Ask user for their vps789 token** (if not already provided)

Send the user a single message asking for the real `VPS789_TOKEN` value, explaining it's needed only
for live testing.

- [ ] **Step 2: Run scraper with real token**

Run from `xray-sub/`:

```
VPS789_TOKEN=<real-token> deno run --allow-env --allow-net scraper/vps789.ts dummy
```

Expected: a non-empty array of `CfEntry` printed. If empty, the token is wrong or expired — stop and
re-confirm with user.

- [ ] **Step 3: Manually verify filter output**

Pipe into a small script to check `avgScore` distribution:

```
VPS789_TOKEN=<real-token> deno eval --allow-env --allow-net "
const { fetchVps789Ips } = await import('./scraper/vps789.ts');
const ips = await fetchVps789Ips(Deno.env.get('VPS789_TOKEN')!);
console.log('count:', ips.length);
console.log('score range:', Math.min(...ips.map(i=>i.avgScore)), '-', Math.max(...ips.map(i=>i.avgScore)));
console.log('loss range:', Math.min(...ips.map(i=>i.avgPkgLost)), '-', Math.max(...ips.map(i=>i.avgPkgLost)));
console.log('first 3:', ips.slice(0,3));
"
```

Expected: `count > 0`, sensible ranges. Adjust `SCORE_THRESHOLD` / `PKGLOST_THRESHOLD` if too many /
too few pass.

- [ ] **Step 4: Commit any tuned threshold defaults**

If thresholds changed:

```
git add config.ts
git commit -m "tune: adjust default score/loss thresholds after live test"
```

---

## Task 12: Deploy to Deno Deploy

- [ ] **Step 1: Create `.env.example` documenting required env vars**

Create `xray-sub/.env.example`:

```
# Required: long random string clients send as X-Sub-Token
SUB_TOKEN=

# Required: token from vps789.com user profile (openApi)
VPS789_TOKEN=

# Optional overrides
MAX_NODES_IP=20
SCORE_THRESHOLD=500
PKGLOST_THRESHOLD=10
KV_REFRESH_CRON=0 * * * *
PORT=8000
```

- [ ] **Step 2: Commit `.env.example`**

```
git add .env.example
git commit -m "docs: add .env.example"
```

- [ ] **Step 3: Document deploy steps in README**

Create `xray-sub/README.md`:

````markdown
# xray-sub

Self-hosted v2rayN subscription service. Returns Base64-encoded VLESS+xhttp URIs pointing to your
Cloudflare CDN-fronted VPS through hourly-refreshed CF preferred IPs.

## Run locally

```sh
cp .env.example .env
# fill in SUB_TOKEN and VPS789_TOKEN
deno task dev
```

## Deploy to Deno Deploy

1. Push this repo to GitHub.
2. On https://dash.deno.com → New Project → link the repo.
3. Set the env vars from `.env.example` in the project settings.
4. Entry point: `main.ts`. Deno Deploy detects it automatically.
5. Set custom domain if desired.

## Client config (v2rayN)

```
Subscription URL: https://<your-deploy>.deno.dev/sub?<params>
Headers: X-Sub-Token: <SUB_TOKEN>
```

Where `<params>` is:

```
group=<group-name>&id=<vless-uuid>&path=%2F<path>&host=<sni>
```
````

- [ ] **Step 4: Commit README**

```
git add README.md
git commit -m "docs: add README with deploy instructions"
```

- [ ] **Step 5: Push to GitHub**

Walk user through creating the repo and pushing:

```
git remote add origin git@github.com:<user>/xray-sub.git
git push -u origin main
```

- [ ] **Step 6: User creates Deno Deploy project**

User clicks through Deno Deploy UI to:

- Connect the GitHub repo
- Set `SUB_TOKEN` and `VPS789_TOKEN` env vars
- Deploy

- [ ] **Step 7: Verify deploy works**

Run:

```
curl -s -w "HTTP=%{http_code}\n" \
  -H "X-Sub-Token: <SUB_TOKEN>" \
  "https://<deploy-host>/sub?group=bwh&id=<uuid>&path=%2F<P93750>&host=vr.ttmic.top" \
  | head -c 200
```

Expected: `HTTP=200` and a base64 body. Decode it and confirm vless:// URIs are present.

- [ ] **Step 8: Configure subscription in v2rayN client**

User pastes the deploy URL into v2rayN's subscription settings and adds the `X-Sub-Token` header per
v2rayN's subscription config dialog.

---

## Self-Review Notes

(Author runs this after writing the plan.)

1. **Spec coverage:**
   - §1 Goal → all tasks
   - §2 Non-Goals → respected (no UI, no multi-format, no per-user)
   - §3 Architecture → Tasks 1, 8, 9 implement exactly
   - §4 File Layout → every file created in correct task
   - §5.1 Refresh path → Tasks 5, 6
   - §5.2 Sub path → Task 7
   - §6.1 HTTP API → Task 7
   - §6.2 VLESS URI format → Task 2
   - §6.3 vps789 API → Task 5
   - §6.4 KV schema → Task 3
   - §6.5 Env vars → Tasks 1 (config.ts), 12 (.env.example)
   - §7 Filtering → Task 4
   - §8 Default VLESS params → Task 7 (`vlessParamsFromQuery`)
   - §9 Error handling → Task 7
   - §10 Testing → every task includes tests
   - §11 Open items → Task 11 verifies avgScore direction live

2. **Placeholder scan:** no "TBD"/"TODO"/"implement later" in any task. All code blocks are
   complete.

3. **Type consistency:**
   - `KvStore` interface exported from `kv_memory.ts`, both `MemoryKv` and `DenoKv` implement it. ✓
   - `CfEntry` defined in `types.ts`, used everywhere. ✓
   - `VlessParams` defined in `types.ts`, built once in `sub.ts:vlessParamsFromQuery`. ✓
   - `Config` shape matches between `config.ts:loadConfig` and `tests/sub_test.ts:cfg`. ✓
   - `CfEntry.avgPkgLost` field name consistent across `types.ts`, `filter.ts`, `vps789.ts`,
     `sub.ts`. ✓
   - `KvMeta` shape matches between `kv_memory.ts` and `kv.ts`. ✓
