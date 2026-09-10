/**
 * Replay HMAC verification matching the core Worker
 * (`requeue-hq/requeue` `src/replay.ts` + `src/crypto.ts`).
 *
 * When an endpoint has a `secret`, the Worker POSTs the stored payload to
 * `target_url` and sets:
 *
 * - `X-Requeue-Event-Id`
 * - `X-Requeue-Endpoint-Id` (always sent; not part of the HMAC)
 * - `X-Requeue-Timestamp` — unix seconds
 * - `X-Requeue-Signature: sha256=<hex>`
 *
 * Canonical string (byte-for-byte with the Worker):
 *
 * ```
 * {timestamp}.{eventId}.{payload}
 * ```
 *
 * `payload` is the raw request body — the stored payload string — not a
 * re-serialized JSON object.
 */

export const REQUEUE_EVENT_ID_HEADER = "x-requeue-event-id";
export const REQUEUE_ENDPOINT_ID_HEADER = "x-requeue-endpoint-id";
export const REQUEUE_TIMESTAMP_HEADER = "x-requeue-timestamp";
export const REQUEUE_SIGNATURE_HEADER = "x-requeue-signature";

/** Reject timestamps older or newer than this many seconds by default. */
export const DEFAULT_REPLAY_TOLERANCE_SECONDS = 300;

/**
 * Headers from Fetch (`Headers`), Express/Hono/Node (`IncomingHttpHeaders`),
 * or a plain object. Lookup is case-insensitive.
 */
export type ReplayHeadersInput =
  | Headers
  | Record<string, string | readonly string[] | undefined | null>;

export type VerifyReplaySignatureParams = {
  /** Endpoint HMAC secret (the same value passed to `createEndpoint`). */
  secret: string;
  headers: ReplayHeadersInput;
  /**
   * Raw request body as received. Must match the Worker-signed payload
   * string (`event.payload` in D1), not a re-stringified object.
   */
  payload: string | Uint8Array | ArrayBuffer;
  /**
   * Max clock skew for `X-Requeue-Timestamp`, in seconds.
   * Defaults to 300. Pass `false` to skip the freshness check.
   */
  tolerance?: number | false;
  /** Override current unix time (seconds). Useful in tests. */
  now?: number;
};

export type ReplayVerifyFailureReason =
  | "missing_secret"
  | "missing_event_id"
  | "missing_timestamp"
  | "missing_signature"
  | "invalid_timestamp"
  | "timestamp_expired"
  | "invalid_signature";

export type ReplayVerifySuccess = {
  ok: true;
  eventId: string;
  timestamp: string;
  endpointId?: string;
};

export type ReplayVerifyFailure = {
  ok: false;
  reason: ReplayVerifyFailureReason;
  eventId?: string;
  timestamp?: string;
  endpointId?: string;
};

export type ReplayVerifyResult = ReplayVerifySuccess | ReplayVerifyFailure;

/**
 * Build the Worker canonical string: `{timestamp}.{eventId}.{payload}`.
 */
export function canonicalReplayString(
  timestamp: string,
  eventId: string,
  payload: string,
): string {
  return `${timestamp}.${eventId}.${payload}`;
}

/**
 * Verify a Requeue replay delivery HMAC.
 *
 * Uses Web Crypto (`crypto.subtle`) — available in Node 20+ and modern
 * browsers. Returns a typed result; check `result.ok`.
 */
export async function verifyReplaySignature(
  params: VerifyReplaySignatureParams,
): Promise<ReplayVerifyResult> {
  const secret = params.secret?.trim() ?? "";
  const eventId = headerValue(params.headers, REQUEUE_EVENT_ID_HEADER);
  const timestamp = headerValue(params.headers, REQUEUE_TIMESTAMP_HEADER);
  const signature = headerValue(params.headers, REQUEUE_SIGNATURE_HEADER);
  const endpointId = headerValue(params.headers, REQUEUE_ENDPOINT_ID_HEADER);
  const extras = optionalIds(eventId, timestamp, endpointId);

  if (!secret) {
    return fail("missing_secret", extras);
  }
  if (!eventId) {
    return fail("missing_event_id", extras);
  }
  if (!timestamp) {
    return fail("missing_timestamp", extras);
  }
  if (!signature) {
    return fail("missing_signature", extras);
  }

  if (!isUnixSeconds(timestamp)) {
    return fail("invalid_timestamp", extras);
  }

  const tolerance = params.tolerance ?? DEFAULT_REPLAY_TOLERANCE_SECONDS;
  if (tolerance !== false) {
    const now = params.now ?? Math.floor(Date.now() / 1000);
    const skew = Math.abs(now - Number.parseInt(timestamp, 10));
    if (skew > tolerance) {
      return fail("timestamp_expired", extras);
    }
  }

  const payload = payloadToString(params.payload);
  const expectedHex = await hmacSha256Hex(secret, canonicalReplayString(timestamp, eventId, payload));
  const providedHex = parseSignatureHex(signature);
  if (!providedHex || !timingSafeEqual(expectedHex, providedHex)) {
    return fail("invalid_signature", extras);
  }

  return endpointId
    ? { ok: true, eventId, timestamp, endpointId }
    : { ok: true, eventId, timestamp };
}

/** Alias for {@link verifyReplaySignature}. */
export const verifyRequeueSignature = verifyReplaySignature;

function fail(
  reason: ReplayVerifyFailureReason,
  extras: Pick<ReplayVerifyFailure, "eventId" | "timestamp" | "endpointId">,
): ReplayVerifyFailure {
  return { ok: false, reason, ...extras };
}

function optionalIds(
  eventId: string | undefined,
  timestamp: string | undefined,
  endpointId: string | undefined,
): Pick<ReplayVerifyFailure, "eventId" | "timestamp" | "endpointId"> {
  const extras: Pick<ReplayVerifyFailure, "eventId" | "timestamp" | "endpointId"> = {};
  if (eventId) extras.eventId = eventId;
  if (timestamp) extras.timestamp = timestamp;
  if (endpointId) extras.endpointId = endpointId;
  return extras;
}

function headerValue(headers: ReplayHeadersInput, name: string): string | undefined {
  const wanted = name.toLowerCase();

  if (typeof Headers !== "undefined" && headers instanceof Headers) {
    return emptyToUndefined(headers.get(name));
  }

  for (const [key, raw] of Object.entries(headers)) {
    if (key.toLowerCase() !== wanted) continue;
    if (raw == null) return undefined;
    const value = Array.isArray(raw) ? raw[0] : raw;
    return typeof value === "string" ? emptyToUndefined(value) : undefined;
  }

  return undefined;
}

function emptyToUndefined(value: string | null | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function payloadToString(payload: string | Uint8Array | ArrayBuffer): string {
  if (typeof payload === "string") return payload;
  const bytes = payload instanceof ArrayBuffer ? new Uint8Array(payload) : payload;
  return new TextDecoder().decode(bytes);
}

function isUnixSeconds(value: string): boolean {
  return /^[0-9]+$/.test(value);
}

function parseSignatureHex(value: string): string | undefined {
  const match = /^sha256=([0-9a-fA-F]+)$/.exec(value);
  return match?.[1]?.toLowerCase();
}

async function hmacSha256Hex(secret: string, value: string): Promise<string> {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) {
    throw new Error("Web Crypto is required to verify Requeue replay signatures");
  }

  const key = await subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await subtle.sign("HMAC", key, new TextEncoder().encode(value));
  return bytesToHex(new Uint8Array(sig));
}

function bytesToHex(bytes: Uint8Array): string {
  return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function timingSafeEqual(left: string, right: string): boolean {
  const encoder = new TextEncoder();
  const a = encoder.encode(left);
  const b = encoder.encode(right);
  const len = Math.max(a.length, b.length);
  let diff = a.length === b.length ? 0 : 1;
  for (let i = 0; i < len; i++) {
    diff |= (a[i] ?? 0) ^ (b[i] ?? 0);
  }
  return diff === 0;
}
