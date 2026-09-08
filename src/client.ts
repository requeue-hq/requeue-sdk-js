import { RequeueError } from "./errors.js";
import type {
  ApiErrorBody,
  CreateEndpointParams,
  CreateEndpointResponse,
  FetchLike,
  GetEndpointResponse,
  GetEventResponse,
  IngestParams,
  IngestResponse,
  ListEndpointsResponse,
  ListEventsParams,
  ListEventsResponse,
  ReplayParams,
  ReplayResponse,
  RequeueClientOptions,
} from "./types.js";

const DEFAULT_BASE_URL = "http://127.0.0.1:8787";
const SDK_USER_AGENT = "requeue-sdk-js/0.1.0";

export class Requeue {
  readonly apiKey: string;
  readonly baseUrl: string;
  private readonly fetchImpl: FetchLike;

  constructor(options: RequeueClientOptions) {
    const apiKey = options.apiKey?.trim();
    if (!apiKey) {
      throw new RequeueError("apiKey is required", {
        status: 0,
        code: "invalid_options",
      });
    }

    this.apiKey = apiKey;
    this.baseUrl = normalizeBaseUrl(options.baseUrl ?? DEFAULT_BASE_URL);
    this.fetchImpl = options.fetch ?? globalThis.fetch.bind(globalThis);
  }

  /** POST /v1/endpoints — create a replay destination. */
  createEndpoint(params: CreateEndpointParams): Promise<CreateEndpointResponse> {
    if (!params.target_url?.trim()) {
      throw new RequeueError("target_url is required", {
        status: 0,
        code: "invalid_options",
      });
    }

    return this.request<CreateEndpointResponse>("/v1/endpoints", {
      method: "POST",
      auth: true,
      body: {
        name: params.name,
        target_url: params.target_url,
        secret: params.secret,
      },
    });
  }

  /** GET /v1/endpoints — list project endpoints (no raw secret). */
  listEndpoints(): Promise<ListEndpointsResponse> {
    return this.request<ListEndpointsResponse>("/v1/endpoints", {
      method: "GET",
      auth: true,
    });
  }

  /** GET /v1/endpoints/:id — fetch one project endpoint. */
  getEndpoint(id: string): Promise<GetEndpointResponse> {
    return this.request<GetEndpointResponse>(
      `/v1/endpoints/${encodeURIComponent(requireId(id, "id"))}`,
      {
        method: "GET",
        auth: true,
      },
    );
  }

  /**
   * POST /v1/ingest/:endpointKey — store a failed event.
   * Authenticated by the endpoint key in the URL, not the management API key.
   */
  ingest(endpointKey: string, params: IngestParams): Promise<IngestResponse> {
    const key = requireId(endpointKey, "endpointKey");
    return this.request<IngestResponse>(`/v1/ingest/${encodeURIComponent(key)}`, {
      method: "POST",
      auth: false,
      body: {
        payload: params.payload,
        reason: params.reason,
        source: params.source,
        headers: params.headers,
        content_type: params.content_type,
      },
    });
  }

  /** GET /v1/events — list events, optionally filtered by status and endpoint. */
  listEvents(params: ListEventsParams = {}): Promise<ListEventsResponse> {
    return this.request<ListEventsResponse>("/v1/events", {
      method: "GET",
      auth: true,
      query: {
        status: params.status,
        endpoint_id: params.endpoint_id,
        limit: params.limit,
      },
    });
  }

  /** GET /v1/events/:id — event plus replay attempts. */
  getEvent(id: string): Promise<GetEventResponse> {
    return this.request<GetEventResponse>(`/v1/events/${encodeURIComponent(requireId(id, "id"))}`, {
      method: "GET",
      auth: true,
    });
  }

  /**
   * POST /v1/events/:id/replay — deliver now, or enqueue for the outbox cron.
   */
  replay(id: string, params: ReplayParams = {}): Promise<ReplayResponse> {
    return this.request<ReplayResponse>(
      `/v1/events/${encodeURIComponent(requireId(id, "id"))}/replay`,
      {
        method: "POST",
        auth: true,
        body: params.enqueue === true ? { enqueue: true } : undefined,
      },
    );
  }

  private async request<T>(
    path: string,
    options: {
      method: string;
      auth: boolean;
      body?: Record<string, unknown> | undefined;
      query?: Record<string, string | number | undefined> | undefined;
    },
  ): Promise<T> {
    const url = new URL(path, `${this.baseUrl}/`);
    if (options.query) {
      for (const [key, value] of Object.entries(options.query)) {
        if (value !== undefined && value !== "") {
          url.searchParams.set(key, String(value));
        }
      }
    }

    const headers: Record<string, string> = {
      Accept: "application/json",
      "User-Agent": SDK_USER_AGENT,
    };

    if (options.auth) {
      headers.Authorization = `Bearer ${this.apiKey}`;
    }

    const init: RequestInit = {
      method: options.method,
      headers,
    };

    if (options.body !== undefined) {
      headers["Content-Type"] = "application/json";
      init.body = JSON.stringify(omitUndefined(options.body));
    }

    let response: Response;
    try {
      response = await this.fetchImpl(url, init);
    } catch (error) {
      throw new RequeueError(error instanceof Error ? error.message : "Network error", {
        status: 0,
        code: "network_error",
        body: error,
      });
    }

    const body = await readBody(response);
    if (!response.ok) {
      throw toApiError(response.status, body);
    }

    return body as T;
  }
}

function normalizeBaseUrl(value: string): string {
  const trimmed = value.trim().replace(/\/+$/, "");
  if (!trimmed) {
    throw new RequeueError("baseUrl is required", {
      status: 0,
      code: "invalid_options",
    });
  }
  return trimmed;
}

function requireId(value: string, field: string): string {
  const trimmed = value?.trim();
  if (!trimmed) {
    throw new RequeueError(`${field} is required`, {
      status: 0,
      code: "invalid_options",
    });
  }
  return trimmed;
}

function omitUndefined(record: Record<string, unknown>): Record<string, unknown> {
  const next: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(record)) {
    if (value !== undefined) {
      next[key] = value;
    }
  }
  return next;
}

async function readBody(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) {
    return undefined;
  }

  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}

function toApiError(status: number, body: unknown): RequeueError {
  const envelope = body as Partial<ApiErrorBody> | null;
  const code = envelope?.error?.code ?? "http_error";
  const message = envelope?.error?.message ?? `Request failed with status ${status}`;
  return new RequeueError(message, { status, code, body });
}
