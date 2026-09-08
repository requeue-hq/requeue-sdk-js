import { afterEach, describe, expect, it, vi } from "vitest";
import { Requeue, RequeueError, isRequeueError } from "../src/index.js";
import type {
  Endpoint,
  GetEndpointResponse,
  ListEndpointsResponse,
  ReplayAttempt,
  RequeueEvent,
} from "../src/index.js";

const API_KEY = "rq_demo_local_dev_only_do_not_use_in_prod";
const BASE_URL = "https://requeue.test";

const endpoint: Endpoint = {
  id: "ep_123",
  project_id: "proj_1",
  name: "Orders worker",
  endpoint_key: "epk_abc",
  target_url: "https://httpbin.org/post",
  ingest_path: "/v1/ingest/epk_abc",
  has_secret: true,
  created_at: "2026-09-04T00:00:00.000Z",
};

const event: RequeueEvent = {
  id: "evt_123",
  endpoint_id: "ep_123",
  status: "failed",
  payload: { order_id: "ord_123", amount: 4200 },
  content_type: "application/json",
  headers: { "x-request-id": "abc" },
  reason: "fulfillment timeout",
  source: "worker",
  created_at: "2026-09-04T00:00:00.000Z",
  updated_at: "2026-09-04T00:00:00.000Z",
};

const attempt: ReplayAttempt = {
  id: "att_1",
  event_id: "evt_123",
  attempted_at: "2026-09-04T00:01:00.000Z",
  success: true,
  status_code: 200,
  response_body: "{\"accepted\":true}",
  error: null,
};

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function createClient(fetchImpl: typeof fetch) {
  return new Requeue({
    apiKey: API_KEY,
    baseUrl: BASE_URL,
    fetch: fetchImpl,
  });
}

function lastCall(fetchMock: ReturnType<typeof vi.fn>) {
  const [input, init] = fetchMock.mock.calls.at(-1) ?? [];
  const url = input instanceof URL ? input.href : String(input);
  const headers = new Headers((init as RequestInit | undefined)?.headers);
  return { url, init: init as RequestInit, headers };
}

describe("Requeue constructor", () => {
  it("requires an api key", () => {
    expect(() => new Requeue({ apiKey: "   " })).toThrow(RequeueError);
    try {
      new Requeue({ apiKey: "" });
    } catch (error) {
      expect(isRequeueError(error)).toBe(true);
      expect((error as RequeueError).code).toBe("invalid_options");
    }
  });

  it("strips a trailing slash from baseUrl", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { events: [], count: 0 }));
    const client = new Requeue({
      apiKey: API_KEY,
      baseUrl: "https://requeue.test/",
      fetch: fetchMock,
    });

    await client.listEvents();
    expect(lastCall(fetchMock).url).toBe("https://requeue.test/v1/events");
  });
});

describe("createEndpoint", () => {
  it("POSTs /v1/endpoints with a bearer token", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(201, { endpoint }));
    const client = createClient(fetchMock);

    const result = await client.createEndpoint({
      name: "Orders worker",
      target_url: "https://httpbin.org/post",
      secret: "optional-hmac-secret",
    });

    expect(result.endpoint.endpoint_key).toBe("epk_abc");
    const { url, init, headers } = lastCall(fetchMock);
    expect(url).toBe("https://requeue.test/v1/endpoints");
    expect(init.method).toBe("POST");
    expect(headers.get("Authorization")).toBe(`Bearer ${API_KEY}`);
    expect(headers.get("Content-Type")).toBe("application/json");
    expect(JSON.parse(String(init.body))).toEqual({
      name: "Orders worker",
      target_url: "https://httpbin.org/post",
      secret: "optional-hmac-secret",
    });
  });

  it("rejects a missing target_url", () => {
    const client = createClient(vi.fn());
    expect(() => client.createEndpoint({ target_url: "" })).toThrowError(/target_url/);
  });
});

describe("listEndpoints", () => {
  it("GETs /v1/endpoints with a bearer token", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse(200, { endpoints: [endpoint], count: 1 }));
    const client = createClient(fetchMock);

    const result: ListEndpointsResponse = await client.listEndpoints();

    expect(result.count).toBe(1);
    expect(result.endpoints[0]?.endpoint_key).toBe("epk_abc");
    const { url, init, headers } = lastCall(fetchMock);
    expect(url).toBe("https://requeue.test/v1/endpoints");
    expect(init.method).toBe("GET");
    expect(headers.get("Authorization")).toBe(`Bearer ${API_KEY}`);
    expect(init.body).toBeUndefined();
  });
});

describe("getEndpoint", () => {
  it("GETs /v1/endpoints/:id", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { endpoint }));
    const client = createClient(fetchMock);

    const result: GetEndpointResponse = await client.getEndpoint("ep_123");

    expect(result.endpoint.id).toBe("ep_123");
    const { url, init, headers } = lastCall(fetchMock);
    expect(url).toBe("https://requeue.test/v1/endpoints/ep_123");
    expect(init.method).toBe("GET");
    expect(headers.get("Authorization")).toBe(`Bearer ${API_KEY}`);
  });

  it("rejects a missing id", () => {
    const client = createClient(vi.fn());
    expect(() => client.getEndpoint("   ")).toThrowError(/id is required/);
  });
});

describe("ingest", () => {
  it("POSTs the preferred envelope without a management key", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(201, { event }));
    const client = createClient(fetchMock);

    const result = await client.ingest("epk_abc", {
      payload: { order_id: "ord_123", amount: 4200 },
      reason: "fulfillment timeout",
      source: "worker",
      headers: { "x-request-id": "abc" },
    });

    expect(result.event.status).toBe("failed");
    const { url, init, headers } = lastCall(fetchMock);
    expect(url).toBe("https://requeue.test/v1/ingest/epk_abc");
    expect(init.method).toBe("POST");
    expect(headers.get("Authorization")).toBeNull();
    expect(JSON.parse(String(init.body))).toEqual({
      payload: { order_id: "ord_123", amount: 4200 },
      reason: "fulfillment timeout",
      source: "worker",
      headers: { "x-request-id": "abc" },
    });
  });
});

describe("listEvents", () => {
  it("sends status and limit query params", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse(200, { events: [event], count: 1 }));
    const client = createClient(fetchMock);

    const result = await client.listEvents({ status: "failed", limit: 20 });

    expect(result.count).toBe(1);
    const { url, headers } = lastCall(fetchMock);
    expect(url).toBe("https://requeue.test/v1/events?status=failed&limit=20");
    expect(headers.get("Authorization")).toBe(`Bearer ${API_KEY}`);
  });

  it("sends optional endpoint_id", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse(200, { events: [event], count: 1 }));
    const client = createClient(fetchMock);

    const result = await client.listEvents({
      status: "failed",
      endpoint_id: "ep_123",
      limit: 20,
    });

    expect(result.events[0]?.endpoint_id).toBe("ep_123");
    expect(lastCall(fetchMock).url).toBe(
      "https://requeue.test/v1/events?status=failed&endpoint_id=ep_123&limit=20",
    );
  });

  it("omits empty query params", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { events: [], count: 0 }));
    const client = createClient(fetchMock);

    await client.listEvents();
    expect(lastCall(fetchMock).url).toBe("https://requeue.test/v1/events");
  });
});

describe("getEvent", () => {
  it("GETs /v1/events/:id", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse(200, { event, replay_attempts: [attempt] }));
    const client = createClient(fetchMock);

    const result = await client.getEvent("evt_123");

    expect(result.replay_attempts).toHaveLength(1);
    const { url, init } = lastCall(fetchMock);
    expect(url).toBe("https://requeue.test/v1/events/evt_123");
    expect(init.method).toBe("GET");
  });
});

describe("replay", () => {
  it("POSTs a synchronous replay with no body", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse(200, {
        event: { ...event, status: "replayed" },
        attempt,
        queued: false,
      }),
    );
    const client = createClient(fetchMock);

    const result = await client.replay("evt_123");

    expect(result.queued).toBe(false);
    expect(result.attempt?.success).toBe(true);
    const { url, init, headers } = lastCall(fetchMock);
    expect(url).toBe("https://requeue.test/v1/events/evt_123/replay");
    expect(init.method).toBe("POST");
    expect(init.body).toBeUndefined();
    expect(headers.get("Authorization")).toBe(`Bearer ${API_KEY}`);
    expect(headers.get("Content-Type")).toBeNull();
  });

  it("POSTs { enqueue: true } for the outbox cron", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse(200, {
        event: { ...event, status: "pending_replay" },
        queued: true,
      }),
    );
    const client = createClient(fetchMock);

    const result = await client.replay("evt_123", { enqueue: true });

    expect(result.queued).toBe(true);
    expect(JSON.parse(String(lastCall(fetchMock).init.body))).toEqual({ enqueue: true });
  });
});

describe("error handling", () => {
  it("maps { error: { code, message } } from the core API", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse(401, {
        error: { code: "unauthorized", message: "Invalid API key" },
      }),
    );
    const client = createClient(fetchMock);

    await expect(client.listEvents()).rejects.toMatchObject({
      name: "RequeueError",
      status: 401,
      code: "unauthorized",
      message: "Invalid API key",
    });
  });

  it("wraps network failures", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new TypeError("fetch failed"));
    const client = createClient(fetchMock);

    await expect(client.getEvent("evt_123")).rejects.toMatchObject({
      code: "network_error",
      status: 0,
      message: "fetch failed",
    });
  });

  it("falls back when the error body is not the API envelope", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("nope", { status: 502 }));
    const client = createClient(fetchMock);

    await expect(client.listEvents()).rejects.toMatchObject({
      status: 502,
      code: "http_error",
      message: "Request failed with status 502",
    });
  });
});
