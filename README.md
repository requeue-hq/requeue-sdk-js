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

Point the client at a Requeue worker. Local Wrangler (from the [core repo](https://github.com/requeue-hq/requeue)) listens on `http://127.0.0.1:8787`. The first core migration seeds this **local/demo** key — do not use it in production:

```
rq_demo_local_dev_only_do_not_use_in_prod
```

```ts
import { Requeue, RequeueError } from "@requeue-hq/sdk";

const requeue = new Requeue({
  apiKey: process.env.REQUEUE_API_KEY ?? "rq_demo_local_dev_only_do_not_use_in_prod",
  baseUrl: process.env.REQUEUE_BASE_URL ?? "http://127.0.0.1:8787",
});
```

The examples below match the core API curl happy path.

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
curl -sS "http://127.0.0.1:8787/v1/events?status=failed" \
  -H "Authorization: Bearer rq_demo_local_dev_only_do_not_use_in_prod"

curl -sS http://127.0.0.1:8787/v1/events/evt_REPLACE_ME \
  -H "Authorization: Bearer rq_demo_local_dev_only_do_not_use_in_prod"

curl -sS -X POST http://127.0.0.1:8787/v1/events/evt_REPLACE_ME/replay \
  -H "Authorization: Bearer rq_demo_local_dev_only_do_not_use_in_prod"
```

```ts
const { events } = await requeue.listEvents({ status: "failed", limit: 50 });

const detail = await requeue.getEvent(event.id);
// detail.event, detail.replay_attempts

const replayed = await requeue.replay(event.id);
// replayed.queued === false, replayed.attempt is the delivery result

// Or enqueue for the once-a-minute D1 outbox cron:
await requeue.replay(event.id, { enqueue: true });
```

Event statuses: `failed`, `pending_replay`, `replayed`, `replay_failed`.

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
| `ingest(endpointKey, { payload, reason?, source?, headers? })` | `POST /v1/ingest/:endpointKey` | endpoint key |
| `listEvents({ status?, limit? })` | `GET /v1/events` | Bearer |
| `getEvent(id)` | `GET /v1/events/:id` | Bearer |
| `replay(id, { enqueue? })` | `POST /v1/events/:id/replay` | Bearer |

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
