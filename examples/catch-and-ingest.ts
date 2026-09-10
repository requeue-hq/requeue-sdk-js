/**
 * Catch a failed job and ingest the original payload into Requeue.
 *
 * Against local Wrangler (core repo `npm run dev`):
 *
 *   npx tsx examples/catch-and-ingest.ts
 *
 * Local demo key (Wrangler / tests only — never send this to hosted):
 *   rq_demo_local_dev_only_do_not_use_in_prod
 *
 * After publish, switch the import to `@requeue-hq/sdk`.
 */

import { Requeue, RequeueError } from "../src/index.js";

const requeue = new Requeue({
  // Hosted: set REQUEUE_API_KEY to a key Maya minted; never the local demo value.
  apiKey: process.env.REQUEUE_API_KEY ?? "rq_demo_local_dev_only_do_not_use_in_prod",
  baseUrl: process.env.REQUEUE_BASE_URL ?? "http://127.0.0.1:8787",
});

async function fulfillOrder(_order: { order_id: string; amount: number }): Promise<void> {
  throw new Error("fulfillment timeout");
}

async function main(): Promise<void> {
  const endpointKey = process.env.REQUEUE_ENDPOINT_KEY;
  const endpoint = endpointKey
    ? { endpoint_key: endpointKey }
    : (
        await requeue.createEndpoint({
          name: "Orders worker",
          target_url: process.env.REQUEUE_TARGET_URL ?? "https://httpbin.org/post",
          secret: process.env.REQUEUE_ENDPOINT_SECRET ?? "optional-hmac-secret",
        })
      ).endpoint;

  const order = { order_id: "ord_123", amount: 4200 };

  try {
    await fulfillOrder(order);
  } catch (error) {
    const reason = error instanceof Error ? error.message : "unknown failure";
    const { event } = await requeue.ingest(endpoint.endpoint_key, {
      payload: order,
      reason,
      source: "worker",
    });

    console.log(`ingested ${event.id} (${event.status})`);
    console.log(`replay: POST ${requeue.baseUrl}/v1/events/${event.id}/replay`);
  }
}

main().catch((error: unknown) => {
  if (error instanceof RequeueError) {
    console.error(error.status, error.code, error.message);
  } else {
    console.error(error);
  }
  process.exitCode = 1;
});
