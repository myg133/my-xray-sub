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
