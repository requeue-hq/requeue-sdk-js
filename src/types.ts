/** Event statuses returned by the Requeue core API. */
export type EventStatus = "failed" | "pending_replay" | "replayed" | "replay_failed";

/** Fetch-compatible function, injectable for tests or custom runtimes. */
export type FetchLike = typeof fetch;

export type RequeueClientOptions = {
  /** Management API key. Sent as `Authorization: Bearer <apiKey>`. */
  apiKey: string;
  /**
   * Base URL of the Requeue worker, with no trailing slash.
   * Defaults to the local Wrangler address used in the core API docs.
   */
  baseUrl?: string;
  /** Override `fetch` (useful for tests). Defaults to `globalThis.fetch`. */
  fetch?: FetchLike;
};

export type CreateEndpointParams = {
  /** Human-readable name. Defaults to the target URL hostname on the server. */
  name?: string;
  /** URL that should receive replayed payloads. */
  target_url: string;
  /** Optional HMAC secret used to sign replay deliveries. */
  secret?: string;
};

export type Endpoint = {
  id: string;
  project_id: string;
  name: string;
  endpoint_key: string;
  target_url: string;
  ingest_path: string;
  has_secret: boolean;
  created_at: string;
};

export type IngestParams = {
  /** Original failed payload. Replay POSTs this value to `target_url`. */
  payload: unknown;
  reason?: string;
  source?: string;
  headers?: Record<string, string> | unknown;
  content_type?: string;
};

export type RequeueEvent = {
  id: string;
  endpoint_id: string;
  status: EventStatus;
  payload: unknown;
  content_type: string;
  headers: unknown;
  reason: string | null;
  source: string | null;
  created_at: string;
  updated_at: string;
};

export type ReplayAttempt = {
  id: string;
  event_id: string;
  attempted_at: string;
  success: boolean;
  status_code: number | null;
  response_body: string | null;
  error: string | null;
};

export type ListEventsParams = {
  status?: EventStatus;
  /** Page size. Core API clamps to 1–200 and defaults to 50. */
  limit?: number;
};

export type ReplayParams = {
  /**
   * When true, mark the event `pending_replay` for the D1 outbox cron
   * instead of delivering immediately.
   */
  enqueue?: boolean;
};

export type CreateEndpointResponse = {
  endpoint: Endpoint;
};

export type ListEndpointsResponse = {
  endpoints: Endpoint[];
  count: number;
};

export type GetEndpointResponse = {
  endpoint: Endpoint;
};

export type IngestResponse = {
  event: RequeueEvent;
};

export type ListEventsResponse = {
  events: RequeueEvent[];
  count: number;
};

export type GetEventResponse = {
  event: RequeueEvent;
  replay_attempts: ReplayAttempt[];
};

export type ReplayResponse = {
  event: RequeueEvent;
  attempt?: ReplayAttempt;
  queued: boolean;
};

export type ApiErrorBody = {
  error: {
    code: string;
    message: string;
  };
};
