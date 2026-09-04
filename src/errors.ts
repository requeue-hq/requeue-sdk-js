export type RequeueErrorOptions = {
  status: number;
  code: string;
  body?: unknown;
};

/**
 * Error thrown for HTTP, network, and client-side validation failures.
 * API errors use the `{ error: { code, message } }` envelope from the core worker.
 */
export class RequeueError extends Error {
  readonly status: number;
  readonly code: string;
  readonly body: unknown;

  constructor(message: string, options: RequeueErrorOptions) {
    super(message);
    this.name = "RequeueError";
    this.status = options.status;
    this.code = options.code;
    this.body = options.body;
  }
}

export function isRequeueError(error: unknown): error is RequeueError {
  return error instanceof RequeueError;
}
