# requeue-sdk-js

Official TypeScript/JavaScript SDK for [Requeue](https://github.com/requeue-hq/requeue).

**Catch failed webhooks & jobs. Replay them.**

This package is a thin client for the open-source Requeue core API (Cloudflare Workers + Hono + D1). Management calls send `Authorization: Bearer <api_key>`. Ingest is authenticated by the endpoint key in the URL.

## Install

```bash
npm install @requeue-hq/sdk
```

Requires Node.js 20+ (native `fetch`). Works in browsers and other runtimes that provide `fetch`.

## Usage

Point the client at a Requeue worker. Local Wrangler (from the [core repo](https://github.com/requeue-hq/requeue)) listens on `http://127.0.0.1:8787`. The hosted API is `https://api.getrequeue.com`. The first core migration seeds this **local/demo** key — do not use it on hosted / production:

```
rq_demo_local_dev_only_do_not_use_in_prod
```

```ts
import { Requeue, RequeueError } from "@requeue-hq/sdk";

const requeue = new Requeue({
  apiKey: process.env.REQUEUE_API_KEY ?? "rq_demo_local_dev_only_do_not_use_in_prod",
  baseUrl: process.env.REQUEUE_BASE_URL ?? "http://127.0.0.1:8787",
  // Hosted: "https://api.getrequeue.com"
});
```

Ask [maya@getrequeue.com](mailto:maya@getrequeue.com) for a hosted key. The examples below match the core API curl happy path.

### Create an endpoint

The URL that should receive replays:

```bash
curl -sS http://127.0.0.1:8787/v1/endpoints \
  -H "Authorization: Bearer rq_demo_local_dev_only_do_not_use_in_prod" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Orders worker",
    "target_url": "https://httpbin.org/post",
    "secret": "optional-hmac-secret"
  }'
```

```ts
const { endpoint } = await requeue.createEndpoint({
  name: "Orders worker",
  target_url: "https://httpbin.org/post",
  secret: "optional-hmac-secret",
});

// Use endpoint.endpoint_key for ingest.
```

### List and fetch endpoints

```ts
const { endpoints, count } = await requeue.listEndpoints();

const { endpoint: fetched } = await requeue.getEndpoint(endpoint.id);
```

`GET /v1/endpoints` is project-scoped. Responses include `endpoint_key` and `has_secret`, never the HMAC `secret`.

### Report a failure

```bash
curl -sS http://127.0.0.1:8787/v1/ingest/epk_REPLACE_ME \
  -H "Content-Type: application/json" \
  -d '{
    "payload": { "order_id": "ord_123", "amount": 4200 },
    "reason": "fulfillment timeout",
    "source": "worker"
  }'
```

```ts
const { event } = await requeue.ingest(endpoint.endpoint_key, {
  payload: { order_id: "ord_123", amount: 4200 },
  reason: "fulfillment timeout",
  source: "worker",
  headers: { "x-request-id": "abc" },
});
```

Ingest does **not** send the management API key. Replay later POSTs the stored `payload` (not the ingest envelope) to `target_url`.

### List, fetch, and replay

```bash
curl -sS "http://127.0.0.1:8787/v1/events?status=failed&endpoint_id=ep_REPLACE_ME" \
  -H "Authorization: Bearer rq_demo_local_dev_only_do_not_use_in_prod"

curl -sS http://127.0.0.1:8787/v1/events/evt_REPLACE_ME \
  -H "Authorization: Bearer rq_demo_local_dev_only_do_not_use_in_prod"

curl -sS -X POST http://127.0.0.1:8787/v1/events/evt_REPLACE_ME/replay \
  -H "Authorization: Bearer rq_demo_local_dev_only_do_not_use_in_prod"
```

```ts
const { events } = await requeue.listEvents({
  status: "failed",
  endpoint_id: endpoint.id,
  limit: 50,
});

const detail = await requeue.getEvent(event.id);
// detail.event, detail.replay_attempts

const replayed = await requeue.replay(event.id);
// replayed.queued === false, replayed.attempt is the delivery result

// Or enqueue for the once-a-minute D1 outbox cron:
await requeue.replay(event.id, { enqueue: true });
```

Event statuses: `failed`, `pending_replay`, `replayed`, `replay_failed`. Optional `endpoint_id` limits the list to one destination.

### Verify a replay signature

When the endpoint has a `secret`, the Worker POSTs the **stored payload** (not the ingest envelope) to `target_url` and signs it. Headers (see [`src/replay.ts`](https://github.com/requeue-hq/requeue/blob/main/src/replay.ts) in core):

| Header | Value |
| --- | --- |
| `X-Requeue-Event-Id` | Event id |
| `X-Requeue-Timestamp` | Unix time in **seconds** |
| `X-Requeue-Signature` | `sha256=<hex>` |
| `X-Requeue-Endpoint-Id` | Endpoint id (always sent; **not** part of the HMAC) |

HMAC-SHA256 is computed over this canonical string — `{timestamp}.{eventId}.{payload}` — where `payload` is the **raw request body** (the stored payload string). Do not `JSON.stringify` a parsed object and expect the signature to match.

```ts
import { verifyReplaySignature } from "@requeue-hq/sdk";

const result = await verifyReplaySignature({
  secret: process.env.REQUEUE_ENDPOINT_SECRET!,
  headers: request.headers,
  payload: rawBody,
});

if (!result.ok) {
  // result.reason: missing_signature | invalid_signature | timestamp_expired | …
}
```

Timestamps older or newer than 5 minutes (`DEFAULT_REPLAY_TOLERANCE_SECONDS`) are rejected. Pass `tolerance: false` to skip the freshness check. `verifyRequeueSignature` is an alias. Uses Web Crypto (`crypto.subtle`) in Node 20+ and browsers.

## Examples

Scripts in [`examples/`](examples/) that run against local Wrangler (`http://127.0.0.1:8787`). Use the documented local demo key as a placeholder only — never a production key.

| File | What it shows |
| --- | --- |
| [`examples/catch-and-ingest.ts`](examples/catch-and-ingest.ts) | `try/catch` around work, then `requeue.ingest` |
| [`examples/verify-replay.ts`](examples/verify-replay.ts) | HTTP handler that verifies the replay HMAC before processing |

```bash
npx tsx examples/catch-and-ingest.ts
REQUEUE_ENDPOINT_SECRET=optional-hmac-secret npx tsx examples/verify-replay.ts
```

## Client

```ts
new Requeue({
  apiKey: string;   // required
  baseUrl?: string; // default http://127.0.0.1:8787
  fetch?: typeof fetch;
});
```

| Method | HTTP | Auth |
| --- | --- | --- |
| `createEndpoint({ name?, target_url, secret? })` | `POST /v1/endpoints` | Bearer |
| `listEndpoints()` | `GET /v1/endpoints` | Bearer |
| `getEndpoint(id)` | `GET /v1/endpoints/:id` | Bearer |
| `ingest(endpointKey, { payload, reason?, source?, headers? })` | `POST /v1/ingest/:endpointKey` | endpoint key |
| `listEvents({ status?, endpoint_id?, limit? })` | `GET /v1/events` | Bearer |
| `getEvent(id)` | `GET /v1/events/:id` | Bearer |
| `replay(id, { enqueue? })` | `POST /v1/events/:id/replay` | Bearer |

`verifyReplaySignature({ secret, headers, payload, tolerance? })` is a local helper (no HTTP). See [Verify a replay signature](#verify-a-replay-signature).

## Errors

Failed responses throw `RequeueError` with the core `{ error: { code, message } }` envelope:

```ts
try {
  await requeue.getEvent("evt_missing");
} catch (error) {
  if (error instanceof RequeueError) {
    console.error(error.status, error.code, error.message);
  }
}
```

| `code` | When |
| --- | --- |
| `invalid_options` | Missing `apiKey`, `target_url`, or id |
| `network_error` | `fetch` threw before an HTTP response |
| API codes (`unauthorized`, `not_found`, …) | Non-2xx from the worker |

## Scripts

```bash
npm install
npm run build
npm test
npm run typecheck
```

## License

[MIT](LICENSE) © 2026 requeue-hq
