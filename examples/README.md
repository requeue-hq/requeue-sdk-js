# Examples

Runnable against local Wrangler from the [core repo](https://github.com/requeue-hq/requeue) (`npm run dev` → `http://127.0.0.1:8787`).

The local/demo management key is a **placeholder for Wrangler only**. Never send it to `https://api.getrequeue.com`.

```
rq_demo_local_dev_only_do_not_use_in_prod
```

From this repo root (after `npm install`):

```bash
# 1. Catch a failure and ingest it
npx tsx examples/catch-and-ingest.ts

# 2. HTTP handler that verifies the replay HMAC (use as target_url)
REQUEUE_ENDPOINT_SECRET=optional-hmac-secret npx tsx examples/verify-replay.ts
```

| File | What it shows |
| --- | --- |
| [`catch-and-ingest.ts`](catch-and-ingest.ts) | `try/catch` around work, then `requeue.ingest` |
| [`verify-replay.ts`](verify-replay.ts) | Verify `X-Requeue-Signature` before processing |

Imports use `../src` so they run from a clone. After `@requeue-hq/sdk` is published, switch those imports to the package name.
