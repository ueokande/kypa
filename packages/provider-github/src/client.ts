import * as crypto from "node:crypto";
import { FatalError, type ScanSettings } from "@kypa/sdk";
import { Octokit, RequestError } from "octokit";
import PQueue from "p-queue";

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
  ) {
    super(`GitHub request failed (${code}).`);
  }
}

export interface ClientOptions extends ScanSettings {
  token: string;
  fetch?: typeof fetch;
  now?: () => number;
}

export class GitHubClient {
  private readonly api: Octokit;

  constructor(options: ClientOptions) {
    const queue = new PQueue({
      concurrency: options.concurrency,
      timeout: options.requestTimeoutSeconds * 1000,
    });
    const retryRateLimit = (
      delay: number,
      _request: unknown,
      _octokit: unknown,
      retryCount: number,
    ) => Number.isFinite(delay) && delay <= 300 && retryCount < options.retries;

    this.api = new Octokit({
      auth: options.token,
      userAgent: "kypa",
      retry: {
        retries: options.retries,
        // Empty repositories are domain results; throttling owns rate-limit retries.
        doNotRetry: [400, 401, 403, 404, 409, 410, 422, 429, 451],
      },
      throttle: {
        id: crypto.randomUUID(),
        onRateLimit: retryRateLimit,
        onSecondaryRateLimit: retryRateLimit,
      },
      // Raw Octokit errors can contain request metadata and response bodies.
      log: { debug() {}, info() {}, warn() {}, error() {} },
      request: {
        fetch: async (input: string | URL | Request, init?: RequestInit) => {
          if (new URL(String(input)).origin !== "https://api.github.com") {
            throw new Error("Invalid API destination.");
          }
          try {
            init?.signal?.throwIfAborted();
            return await (options.fetch ?? fetch)(input, {
              ...init,
              redirect: "error",
            });
          } catch (error) {
            // AbortError stops Octokit's retry plugin, including after a timeout.
            if (init?.signal?.aborted) {
              throw new DOMException("GitHub request cancelled.", "AbortError");
            }
            throw error;
          }
        },
      },
    });
    this.api.hook.wrap("request", async (request, parameters) => {
      const originalSignal = parameters.request.signal;
      try {
        return await queue.add(
          async ({ signal }) => {
            parameters.headers["x-github-api-version"] = "2022-11-28";
            parameters.request = {
              ...parameters.request,
              ...(signal ? { signal } : {}),
            };
            const response = await request(parameters);
            signal?.throwIfAborted();
            if (response.data === null || typeof response.data !== "object") {
              throw new ApiError(response.status, "INVALID_RESPONSE");
            }
            return response;
          },
          originalSignal ? { signal: originalSignal } : {},
        );
      } catch (error) {
        originalSignal?.throwIfAborted();
        throw safeError(error);
      }
    });
  }

  async get(path: string, signal?: AbortSignal): Promise<unknown> {
    validatePath(path);
    const response = await this.api.request(`GET ${path}`, {
      request: signal ? { signal } : {},
    });
    return response.data;
  }

  async *paginate(
    path: string,
    signal?: AbortSignal,
  ): AsyncGenerator<unknown[]> {
    validatePath(path);
    // Bind request options to the function: the pagination iterator forwards
    // method, URL, and headers, but not the request options of a route string.
    const request = this.api.request.defaults({
      method: "GET",
      url: path,
      per_page: 100,
      request: signal ? { signal } : {},
    });
    for await (const response of this.api.paginate.iterator(request)) {
      yield response.data;
    }
  }
}

function validatePath(path: string): void {
  if (!path.startsWith("/") || path.startsWith("//") || path.includes("\\")) {
    throw new Error("Invalid API path.");
  }
}

function safeError(error: unknown): Error {
  if (error instanceof ApiError) {
    return error;
  }
  if (error instanceof Error && error.name === "TimeoutError") {
    return new ApiError(0, "TIMEOUT");
  }
  if (!(error instanceof RequestError) || !error.response) {
    return new ApiError(0, "NETWORK");
  }
  const { status, data, headers } = error.response;
  if (status === 401) {
    return new FatalError(
      "AUTHENTICATION",
      "GitHub authentication is unusable.",
    );
  }
  if (
    status === 409 &&
    data &&
    typeof data === "object" &&
    "message" in data &&
    data.message === "Git Repository is empty."
  ) {
    return new ApiError(409, "EMPTY_REPOSITORY");
  }
  const limited =
    status === 429 ||
    (status === 403 &&
      (headers["retry-after"] !== undefined ||
        headers["x-ratelimit-remaining"] === "0" ||
        /\bsecondary rate\b/i.test(error.message)));
  return new ApiError(status, limited ? "RATE_LIMIT" : "HTTP");
}
