# v2rayn Subscription Service — Design Spec

**Date:** 2026-09-19 **Status:** Draft — awaiting user review **Author:** brainstormed with user

---

## 1. Goal

Build a self-hosted subscription service that returns a list of VLESS-over-xhttp URIs for
v2rayN/v2rayNG clients. Each URI connects to the user's own VPS through a Cloudflare CDN edge (IP),
so the client has many fallback connection points.

The service scrapes Cloudflare preferred IPs from `vps789.com` via its public openApi, caches them
on an hourly schedule, and assembles the subscription on demand.

A custom HTTP header (`X-Sub-Token`) gates access so the subscription cannot be hot-linked by
unknown clients.

---

## 2. Non-Goals (YAGNI)

- No web UI (status, manual refresh)
- No multiple subscription formats (Clash YAML, SIP008, etc.) — Base64 multi-URI only
- No per-user token management — single fixed token in env var
- No automatic token rotation
- No metrics / analytics endpoint
- No backup CDN sources — single source (vps789 openApi `cfIpApi`) for now
- No domain-based nodes — the openApi only returns IPs. The web UI page (`/cfip/?remarks=domain`)
  shows domains but has no public API. If domain nodes become desired, add a second fetcher that
  scrapes that page; defer for now.
- No rate limiting / IP-based throttling
- No client-side support beyond what v2rayN/sing-box already provide

---

## 3. Architecture

```
┌──────────────────────────────────────────────────────────┐
│                    Deno Deploy                           │
│                                                          │
│  ┌──────────────────────┐    ┌──────────────────────┐    │
│  │   Deno.cron (1h)     │    │   HTTP handler       │    │
│  │  fetch+parse vps789  │    │  GET /sub            │    │
│  │   openApi/cfIpApi    │    │  validate token      │    │
│  │  filter+save         │    │  load KV, build URIs │    │
│  └──────────┬───────────┘    │  base64, return      │    │
│             │                └──────────┬───────────┘    │
│      ┌────────────────┐                │                 │
│      │   Deno KV      │◄───────────────┘                 │
│      │ - preferred[]  │                                  │
│      │ - blacklist[]  │                                  │
│      │ - meta         │                                  │
│      └────────────────┘                                  │
└──────────────────────────────────────────────────────────┘
```

**Why Deno Deploy:** free tier covers KV (10k ops/mo, 1 GB storage) and Deno.cron — sufficient for
hourly fetch + per-request read. No ops, automatic HTTPS, global edge.

**Why Deno KV:** persists across cold starts so the subscription remains valid immediately after a
cold start. Without it, a cold start during a refresh window would either serve a stale in-memory
list or fall back to "no data."

---

## 4. Components / File Layout

```
xray-sub/
├── deno.json             # tasks, imports, lint config
├── main.ts               # Deno Deploy entrypoint (export default)
├── config.ts             # env parsing + default values
├── kv.ts                 # KV helpers (typed load/save)
├── types.ts              # shared types: CfEntry, VlessParams, SubRequest
├── scraper/
│   ├── mod.ts            # public: fetchAndStore()
│   ├── vps789.ts         # fetch vps789, parse JSON, return CfEntry[]
│   └── filter.ts         # pure: filterPreferred(entries, blacklist, limit)
├── vless.ts              # pure: buildVlessUri(params, address, remark) → string
├── sub.ts                # HTTP handler for GET /sub
├── cron.ts               # Deno.cron registration
└── tests/
    ├── vless_test.ts
    ├── filter_test.ts
    ├── scraper_test.ts
    └── sub_test.ts
```

Each module has one clear job. `vless.ts` and `filter.ts` are pure functions — easy to test in
isolation. `scraper/` depends only on `fetch` and `types`. `sub.ts` is the only place that knows
about HTTP.

---

## 5. Data Flow

### 5.1 Refresh path (Deno.cron, hourly)

```
Deno.cron fires
  → scraper.fetchAndStore()
    → fetch("https://vps789.com/openApi/cfIpApi?token={VPS789_TOKEN}")
    → parse JSON response → CfEntry[] (merged across CT/CU/CM)
    → filterPreferred(entries, blacklist, limits)
    → save preferred + blacklist + lastFetch to KV
  → on error: write lastError to KV, keep previous preferred data
```

### 5.2 Subscription path (GET /sub)

```
GET /sub?group={group}&id={uuid}&path={urlencoded-path}&host={sni}
Header: X-Sub-Token: <SUB_TOKEN>

  → validate token → 404 if mismatch
  → validate query params → 400 if missing/malformed
  → loadPreferred() from KV → 503 if KV unavailable
  → build VLESS URIs:
    for each preferred entry:
      vlessUri = buildVlessUri({
        id, host, port=443, path, network=xhttp,
        security=tls, sni=host, alpn=h2, fp=chrome, encryption=none
      }, address=entry.value, remark=`${group}-${idx}`)
  → join with "\n", encode as Base64
  → return 200 text/plain
```

If `preferred` is empty in KV (first run, cron hasn't fired), the subscription returns a single URI
whose `address` is the user's `host` value (the SNI). This is a graceful degradation so the client
always gets something — the connection will go through Cloudflare's anycast network via the user's
domain directly.

---

## 6. Interfaces

### 6.1 HTTP API

**Endpoint:** `GET /sub`

**Query params (all required):**

| Param   | Type               | Example                                | Notes                          |
| ------- | ------------------ | -------------------------------------- | ------------------------------ |
| `group` | string             | `bwh-servers`                          | Used as remark prefix          |
| `id`    | string (UUID-like) | `d08096d7-2715-486a-925d-b2e506192385` | VLESS UUID                     |
| `path`  | URL-encoded string | `%2FP93750`                            | Decoded to `/P93750`           |
| `host`  | string             | `vr.ttmic.top`                         | Used as `sni` and `host` field |

**Headers (required):**

| Header        | Value                 |
| ------------- | --------------------- |
| `X-Sub-Token` | `<SUB_TOKEN env var>` |

**Response (200):**

```
Content-Type: text/plain; charset=utf-8
Body: <Base64-encoded newline-joined vless:// URIs>
```

**Failure modes:**

- Missing/invalid `X-Sub-Token` → `404 Not Found` (no body)
- Missing query param → `400 Bad Request` with text body naming the missing param
- KV read failure → `503 Service Unavailable`
- KV empty (cold start, before first cron run) → still returns 200, but only contains one URI using
  `host` as address (so client can connect at least via the SNI directly)

### 6.2 VLESS URI format

```
vless://<uuid>@<address>:<port>?encryption=none&security=tls&sni=<host>&alpn=h2&fp=chrome&type=xhttp&host=<host>&path=<urlencoded-path>#<remark>
```

Example for IP-based entry:

```
vless://d08096d7-2715-486a-925d-b2e506192385@104.16.123.45:443?encryption=none&security=tls&sni=vr.ttmic.top&alpn=h2&fp=chrome&type=xhttp&host=vr.ttmic.top&path=%2FP93750#bwh-servers-1
```

All query values (`sni`, `host`, `path`) are URL-encoded. `path` comes in URL-encoded from the
client (e.g. `%2FP93750`) and is decoded before being re-encoded into the URI per VLESS URI spec.

### 6.3 vps789 API (upstream)

**Endpoint:** `GET https://vps789.com/openApi/cfIpApi?token={VPS789_TOKEN}`

**Auth:** token is passed as a query parameter (`?token=...`). Confirmed from the vps789 openApi
documentation provided by the user.

**Refresh cadence:** server-side refreshes every hour — matches our Deno.cron schedule so we always
see fresh data.

**Response shape:**

```json
{
  "code": 0,
  "message": "true",
  "count": 0,
  "data": {
    "CT": [ /* 电信 / Telecom */ { "ip": "104.19.45.241", "ydLatencyAvg": 180.18, "ltLatencyAvg": 248.1, "dxLatencyAvg": 174.6, "ydPkgLostRateAvg": 4.18, "ltPkgLostRateAvg": 0.89, "dxPkgLostRateAvg": 3.77, "avgScore": 348, "ydScore": 389, "dxScore": 363, "ltScore": 292 }, ... ],
    "CU": [ /* 联通 / Unicom */ ... ],
    "CM": [ /* 移动 / Mobile */ ... ]
  }
}
```

**Field semantics:**

- `ip`: Cloudflare edge IP
- `ydLatencyAvg` / `ltLatencyAvg` / `dxLatencyAvg`: average latency in ms (移动 / 联通 / 电信)
- `ydPkgLostRateAvg` / `ltPkgLostRateAvg` / `dxPkgLostRateAvg`: average packet loss rate in percent
- `avgScore`: composite quality score (higher = worse — see §11 for confirmation during
  implementation)
- `ydScore` / `dxScore` / `ltScore`: same composite per carrier

**Parsing strategy:**

- Merge all three carrier lists (`CT`, `CU`, `CM`) into a single flat list
- When the same IP appears in multiple carrier arrays, keep the entry with the best `avgScore` (or
  merge by min latency)
- Tolerate extra/missing fields (defensive coding)
- Non-zero `code` → treat as fetch failure

**Available-only filter:** implemented via `avgScore <= SCORE_THRESHOLD` (default 500) AND
`avgPkgLostRateAvg <= 10`. Tunable via env vars (see §6.5).

**Alternative endpoint:** `https://vps789.com/openApi/cfIpTop20` returns a daily top-20 list. Less
fresh (refreshes once a day) — only used as fallback if `cfIpApi` is unavailable.

### 6.4 KV schema

| Key                    | Value                                              | Purpose                                                                            |
| ---------------------- | -------------------------------------------------- | ---------------------------------------------------------------------------------- |
| `["preferred", "ips"]` | `CfEntry[]`                                        | Available CF IPs (merged across carriers)                                          |
| `["blacklist", "ips"]` | `string[]`                                         | IPs marked bad (e.g. failed health check)                                          |
| `["meta"]`             | `{ lastFetch: number; lastError: string \| null }` | Last fetch timestamp + last error message (debug). See `KvMeta` in `kv_memory.ts`. |

CfEntry type:

```ts
type CfEntry = {
  value: string; // IP
  type: "ip"; // only "ip" for now; "domain" reserved for future
  avgScore: number; // composite quality score from upstream
  avgLatency: number; // avg of three carrier latencies (ms)
  avgPkgLost: number; // avg of three carrier packet loss (%)
};
```

### 6.5 Environment variables

| Var                 | Required | Default       | Notes                                                                        |
| ------------------- | -------- | ------------- | ---------------------------------------------------------------------------- |
| `SUB_TOKEN`         | yes      | —             | Long random string. Compared with `X-Sub-Token` header on incoming requests. |
| `VPS789_TOKEN`      | yes      | —             | Upstream auth token. Sent as `?token=...` query param to vps789 openApi.     |
| `MAX_NODES_IP`      | no       | `20`          | Cap on IP entries per subscription                                           |
| `KV_REFRESH_CRON`   | no       | `"0 * * * *"` | Deno.cron schedule (hourly)                                                  |
| `SCORE_THRESHOLD`   | no       | `500`         | Max `avgScore` to keep an IP                                                 |
| `PKGLOST_THRESHOLD` | no       | `10`          | Max `avgPkgLostRate` (%) to keep an IP                                       |
| `PORT`              | no       | `8000`        | Local dev port (ignored in Deno Deploy)                                      |

---

## 7. Filtering Rules

When assembling a subscription from KV data:

1. Drop any IP whose `value` is in the blacklist.
2. Drop any IP whose `avgScore > SCORE_THRESHOLD` or `avgPkgLost > PKGLOST_THRESHOLD`. (Implemented
   at fetch time inside `scraper/filter.ts` — only IPs that pass the filter are ever written to KV,
   so KV always holds clean data.)
3. Shuffle remaining entries (Fisher-Yates) so the order is randomized per request — prevents
   lock-in to a single bad IP.
4. Truncate to `MAX_NODES_IP`.

Result: one subscription returns up to `MAX_NODES_IP` URIs, one per IP. Each IP appears at most
once.

---

## 8. Default VLESS Parameters

Derived directly from the user's xray config (`outbounds[0].streamSettings`):

| Field          | Value                             | Source                                                     |
| -------------- | --------------------------------- | ---------------------------------------------------------- |
| `port`         | `443`                             | config outbounds[0].settings.port                          |
| `network`      | `xhttp`                           | config outbounds[0].streamSettings.network                 |
| `security`     | `tls`                             | config outbounds[0].streamSettings.security                |
| `alpn`         | `h2`                              | config outbounds[0].streamSettings.tlsSettings.alpn        |
| `fingerprint`  | `chrome`                          | config outbounds[0].streamSettings.tlsSettings.fingerprint |
| `encryption`   | `none`                            | config outbounds[0].settings.encryption                    |
| `mode` (xhttp) | `auto`                            | config outbounds[0].streamSettings.xhttpSettings.mode      |
| `sni`          | `<host>` from query               | per-request                                                |
| `host` (xhttp) | `<host>` from query               | per-request                                                |
| `path` (xhttp) | `<path>` from query (URL-decoded) | per-request                                                |
| `id`           | `<id>` from query                 | per-request                                                |

---

## 9. Error Handling

| Situation                                    | Behavior                                                               |
| -------------------------------------------- | ---------------------------------------------------------------------- |
| `X-Sub-Token` missing or wrong               | `404 Not Found`, empty body                                            |
| Query param missing or malformed UUID        | `400 Bad Request`, text message                                        |
| Deno KV read fails                           | `503 Service Unavailable`                                              |
| Deno KV empty (first run, cron hasn't fired) | `200`, single URI using `host` as `address` (direct connect fallback)  |
| vps789 fetch fails inside cron               | Log to console + write `lastError` to KV, keep previous preferred data |
| vps789 returns malformed JSON                | Same as fetch failure                                                  |
| vps789 returns 401/403 (token expired)       | Same as fetch failure; `lastError` includes "token expired" hint       |

Cron never throws — failures are recorded in KV and retried at the next tick.

---

## 10. Testing Strategy

### Unit tests (`tests/`)

- **`vless_test.ts`** — `buildVlessUri()` snapshot tests:
  - IP address (IPv4)
  - Domain address
  - Path with special characters (`/`, `%`)
  - Host with subdomain
  - Verifies exact URI string format and URL encoding of `path` and `host` query values

- **`filter_test.ts`** — pure function tests:
  - Drops blacklisted entries
  - Drops entries exceeding `SCORE_THRESHOLD` or `PKGLOST_THRESHOLD`
  - Respects `MAX_NODES_IP` cap
  - (No domain cap needed — domains not supported)
  - Random shuffle produces different orders on repeated calls

- **`scraper_test.ts`** — mock `fetch`:
  - Parses valid vps789 JSON
  - Tolerates missing fields (`delayMs`, `status` variants)
  - Throws on non-200 response
  - Throws on malformed JSON

- **`sub_test.ts`** — integration via `Deno.test` with stub KV:
  - Valid token + valid params → 200 with Base64
  - Invalid token → 404
  - Missing token header → 404
  - Missing query param → 400
  - Empty KV → 200 with single fallback URI

### Test runner

`deno test` (built-in). Mock KV via a small in-memory adapter implementing the same `load/save`
interface as `kv.ts`.

### Linting

`deno fmt --check` + `deno lint` in CI / pre-deploy.

---

## 11. Open Items — To Confirm Before Implementation

1. **`avgScore` direction.** The API doc gives sample values like `348`, `380`, `218`. Lower values
   are assumed to mean better (lower latency + less packet loss), matching the
   `score = latency + lost_penalty` convention used in most CF scanner tools. **Verify during first
   implementation run** — if a value of `348` turns out to mean "rank 348 in the list" (lower =
   better rank → higher score = better), flip the filter direction. Single env var `SCORE_THRESHOLD`
   makes this easy to tune empirically.

2. **UUID format tolerance.** The first old subscription URL contained
   `b239b0bd-3b96-dd98-6625-eeb53f449a3a` (non-RFC4122-v4). The service must accept any UUID-shaped
   string without strict validation — confirm.

3. **`openApi/cfIpApi` is IPs-only.** No domains in this endpoint. Confirmed acceptable; domain
   support deferred.

4. **Token re-issue cadence.** vps789 tokens may expire. If `cfIpApi` starts returning `code != 0`
   for an extended period, we need to know how to refresh the token (user logs in again, copies new
   token, updates `VPS789_TOKEN` env var in Deno Deploy). This is manual but acceptable.

---

## 12. Out of Scope (Future)

- Web UI showing KV state and last refresh status
- Manual `/admin/refresh` trigger (auth-protected)
- Multi-format output (Clash YAML, sing-box JSON)
- Per-user token management
- Health checking preferred IPs (TCP connect to 443) and adding failures to blacklist automatically
- More upstream sources with weighted blending
- Domain-based nodes (would need a second fetcher scraping the web UI page `/cfip/?remarks=domain`)
