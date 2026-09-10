import { describe, expect, it } from "vitest";
import {
  DEFAULT_REPLAY_TOLERANCE_SECONDS,
  REQUEUE_ENDPOINT_ID_HEADER,
  REQUEUE_EVENT_ID_HEADER,
  REQUEUE_SIGNATURE_HEADER,
  REQUEUE_TIMESTAMP_HEADER,
  canonicalReplayString,
  verifyReplaySignature,
  verifyRequeueSignature,
} from "../src/index.js";

const SECRET = "optional-hmac-secret";
const EVENT_ID = "evt_ab12cd34";
const ENDPOINT_ID = "ep_99aa";
const PAYLOAD = '{"order_id":"ord_123","amount":4200}';
const NOW = 1_770_000_000;

/** Independent `node:crypto` createHmac('sha256') digest for the fixture above. */
const KNOWN_HEX = "889b30ad7597cbe7091540ccbb80d9f2bc841912d816521e8b9f9281504051d8";

async function sign(secret: string, timestamp: string, eventId: string, payload: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(canonicalReplayString(timestamp, eventId, payload)),
  );
  const hex = [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
  return `sha256=${hex}`;
}

async function headers(overrides: Record<string, string | undefined> = {}) {
  const timestamp = String(NOW);
  const base: Record<string, string> = {
    [REQUEUE_EVENT_ID_HEADER]: EVENT_ID,
    [REQUEUE_ENDPOINT_ID_HEADER]: ENDPOINT_ID,
    [REQUEUE_TIMESTAMP_HEADER]: timestamp,
    [REQUEUE_SIGNATURE_HEADER]: await sign(SECRET, timestamp, EVENT_ID, PAYLOAD),
  };
  const next: Record<string, string> = {};
  for (const [key, value] of Object.entries({ ...base, ...overrides })) {
    if (value !== undefined) {
      next[key] = value;
    }
  }
  return next;
}

describe("canonicalReplayString", () => {
  it("matches the Worker `{timestamp}.{eventId}.{payload}` format", () => {
    expect(canonicalReplayString("1770000000", "evt_1", '{"a":1}')).toBe(
      '1770000000.evt_1.{"a":1}',
    );
  });
});

describe("verifyReplaySignature", () => {
  it("accepts a valid Worker signature (known node:crypto vector)", async () => {
    const result = await verifyReplaySignature({
      secret: SECRET,
      headers: {
        [REQUEUE_EVENT_ID_HEADER]: EVENT_ID,
        [REQUEUE_ENDPOINT_ID_HEADER]: ENDPOINT_ID,
        [REQUEUE_TIMESTAMP_HEADER]: String(NOW),
        [REQUEUE_SIGNATURE_HEADER]: `sha256=${KNOWN_HEX}`,
      },
      payload: PAYLOAD,
      now: NOW,
    });

    expect(result).toEqual({
      ok: true,
      eventId: EVENT_ID,
      timestamp: String(NOW),
      endpointId: ENDPOINT_ID,
    });
  });

  it("is exported as verifyRequeueSignature", async () => {
    expect(verifyRequeueSignature).toBe(verifyReplaySignature);
    const result = await verifyRequeueSignature({
      secret: SECRET,
      headers: await headers(),
      payload: PAYLOAD,
      now: NOW,
    });
    expect(result.ok).toBe(true);
  });

  it("accepts Fetch Headers and mixed-case names", async () => {
    const timestamp = String(NOW);
    const h = new Headers();
    h.set("X-Requeue-Event-Id", EVENT_ID);
    h.set("X-Requeue-Timestamp", timestamp);
    h.set("X-Requeue-Signature", await sign(SECRET, timestamp, EVENT_ID, PAYLOAD));
    h.set("X-Requeue-Endpoint-Id", ENDPOINT_ID);

    const result = await verifyReplaySignature({
      secret: SECRET,
      headers: h,
      payload: PAYLOAD,
      now: NOW,
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.endpointId).toBe(ENDPOINT_ID);
    }
  });

  it("accepts Node-style array header values and a Uint8Array body", async () => {
    const timestamp = String(NOW);
    const result = await verifyReplaySignature({
      secret: SECRET,
      headers: {
        "X-Requeue-Event-Id": [EVENT_ID],
        "X-Requeue-Timestamp": [timestamp],
        "X-Requeue-Signature": [await sign(SECRET, timestamp, EVENT_ID, PAYLOAD)],
      },
      payload: new TextEncoder().encode(PAYLOAD),
      now: NOW,
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.endpointId).toBeUndefined();
    }
  });

  it("rejects the wrong secret", async () => {
    const result = await verifyReplaySignature({
      secret: "wrong-secret",
      headers: await headers(),
      payload: PAYLOAD,
      now: NOW,
    });

    expect(result).toMatchObject({ ok: false, reason: "invalid_signature" });
  });

  it("rejects a tampered body", async () => {
    const result = await verifyReplaySignature({
      secret: SECRET,
      headers: await headers(),
      payload: '{"order_id":"ord_999","amount":1}',
      now: NOW,
    });

    expect(result).toMatchObject({ ok: false, reason: "invalid_signature" });
  });

  it("rejects a missing signature header", async () => {
    const result = await verifyReplaySignature({
      secret: SECRET,
      headers: await headers({ [REQUEUE_SIGNATURE_HEADER]: undefined }),
      payload: PAYLOAD,
      now: NOW,
    });

    expect(result).toMatchObject({ ok: false, reason: "missing_signature" });
  });

  it("rejects a missing event id header", async () => {
    const result = await verifyReplaySignature({
      secret: SECRET,
      headers: await headers({ [REQUEUE_EVENT_ID_HEADER]: undefined }),
      payload: PAYLOAD,
      now: NOW,
    });

    expect(result).toMatchObject({ ok: false, reason: "missing_event_id" });
  });

  it("rejects a missing timestamp header", async () => {
    const result = await verifyReplaySignature({
      secret: SECRET,
      headers: await headers({ [REQUEUE_TIMESTAMP_HEADER]: undefined }),
      payload: PAYLOAD,
      now: NOW,
    });

    expect(result).toMatchObject({ ok: false, reason: "missing_timestamp" });
  });

  it("rejects an empty secret", async () => {
    const result = await verifyReplaySignature({
      secret: "   ",
      headers: await headers(),
      payload: PAYLOAD,
      now: NOW,
    });

    expect(result).toMatchObject({ ok: false, reason: "missing_secret" });
  });

  it("rejects a signature without the sha256= prefix", async () => {
    const result = await verifyReplaySignature({
      secret: SECRET,
      headers: await headers({ [REQUEUE_SIGNATURE_HEADER]: KNOWN_HEX }),
      payload: PAYLOAD,
      now: NOW,
    });

    expect(result).toMatchObject({ ok: false, reason: "invalid_signature" });
  });

  it("rejects a non-numeric timestamp", async () => {
    const result = await verifyReplaySignature({
      secret: SECRET,
      headers: await headers({ [REQUEUE_TIMESTAMP_HEADER]: "not-a-time" }),
      payload: PAYLOAD,
      now: NOW,
    });

    expect(result).toMatchObject({ ok: false, reason: "invalid_timestamp" });
  });

  it("rejects a timestamp outside the default tolerance", async () => {
    const stale = String(NOW - DEFAULT_REPLAY_TOLERANCE_SECONDS - 1);
    const result = await verifyReplaySignature({
      secret: SECRET,
      headers: await headers({
        [REQUEUE_TIMESTAMP_HEADER]: stale,
        [REQUEUE_SIGNATURE_HEADER]: await sign(SECRET, stale, EVENT_ID, PAYLOAD),
      }),
      payload: PAYLOAD,
      now: NOW,
    });

    expect(result).toMatchObject({ ok: false, reason: "timestamp_expired" });
  });

  it("skips freshness checks when tolerance is false", async () => {
    const stale = String(NOW - 10_000);
    const result = await verifyReplaySignature({
      secret: SECRET,
      headers: await headers({
        [REQUEUE_TIMESTAMP_HEADER]: stale,
        [REQUEUE_SIGNATURE_HEADER]: await sign(SECRET, stale, EVENT_ID, PAYLOAD),
      }),
      payload: PAYLOAD,
      now: NOW,
      tolerance: false,
    });

    expect(result.ok).toBe(true);
  });
});
