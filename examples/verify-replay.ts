/**
 * Verify a Requeue replay HMAC before processing the payload.
 *
 * The Worker signs `{timestamp}.{eventId}.{payload}` (raw body) and sends:
 *   X-Requeue-Event-Id
 *   X-Requeue-Timestamp
 *   X-Requeue-Signature: sha256=<hex>
 *   X-Requeue-Endpoint-Id  (present; not part of the HMAC)
 *
 *   REQUEUE_ENDPOINT_SECRET=optional-hmac-secret npx tsx examples/verify-replay.ts
 *
 * Point an endpoint's `target_url` at this server, ingest a failure, then replay.
 * After publish, switch the import to `@requeue-hq/sdk`.
 *
 * Express (keep the raw body — do not JSON.parse first):
 *
 *   app.post("/hooks", express.raw({ type: "*/*" }), async (req, res) => {
 *     const result = await verifyReplaySignature({
 *       secret: process.env.REQUEUE_ENDPOINT_SECRET!,
 *       headers: req.headers,
 *       payload: req.body,
 *     });
 *     if (!result.ok) return res.status(401).json({ error: result.reason });
 *     // process JSON.parse(req.body.toString()) …
 *   });
 *
 * Hono:
 *
 *   app.post("/hooks", async (c) => {
 *     const rawBody = await c.req.text();
 *     const result = await verifyReplaySignature({
 *       secret: c.env.REQUEUE_ENDPOINT_SECRET,
 *       headers: c.req.raw.headers,
 *       payload: rawBody,
 *     });
 *     if (!result.ok) return c.json({ error: result.reason }, 401);
 *     // process JSON.parse(rawBody) …
 *   });
 */

import http from "node:http";
import { verifyReplaySignature } from "../src/index.js";

const secret = process.env.REQUEUE_ENDPOINT_SECRET ?? "optional-hmac-secret";
const port = Number(process.env.PORT ?? 3456);

const server = http.createServer(async (req, res) => {
  if (req.method !== "POST") {
    res.writeHead(405, { "content-type": "text/plain" });
    res.end("method not allowed");
    return;
  }

  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(chunk as Buffer);
  }
  const rawBody = Buffer.concat(chunks).toString("utf8");

  const result = await verifyReplaySignature({
    secret,
    headers: req.headers,
    payload: rawBody,
  });

  if (!result.ok) {
    res.writeHead(401, { "content-type": "application/json" });
    res.end(JSON.stringify({ ok: false, error: result.reason }));
    return;
  }

  res.writeHead(200, { "content-type": "application/json" });
  res.end(JSON.stringify({ ok: true, eventId: result.eventId }));
});

server.listen(port, "127.0.0.1", () => {
  console.log(`verify-replay listening on http://127.0.0.1:${port}`);
});
