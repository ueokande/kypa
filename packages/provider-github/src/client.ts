import * as timersPromises from "node:timers/promises";
import { FatalError, type ScanSettings } from "@kypa/sdk";
import { Octokit, RequestError } from "octokit";

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
  sleep?: (milliseconds: number, signal?: AbortSignal) => Promise<void>;
  now?: () => number;
}

export class GitHubClient {
  private active = 0;
  private waiters: (() => void)[] = [];

  private readonly api: Octokit;

  constructor(private readonly options: ClientOptions) {
    this.api = new Octokit({
      auth: options.token,
      userAgent: "kypa",
      // The request hook owns Kypa's bounded, cancellable retry policy.
      retry: { enabled: false },
      throttle: { enabled: false },
      // Octokit errors can include response bodies and request metadata.
      log: { debug() {}, info() {}, warn() {}, error() {} },
      request: {
        fetch: (input: string | URL | Request, init?: RequestInit) => {
          const destination = new URL(String(input));
          if (destination.origin !== "https://api.github.com") {
            throw new Error("Invalid API destination.");
          }
          return (options.fetch ?? fetch)(input, {
            ...init,
            redirect: "error",
          });
        },
      },
    });
    this.api.hook.wrap("request", (request, parameters) =>
      this.requestWithPolicy(async (signal) => {
        parameters.headers["x-github-api-version"] = "2022-11-28";
        parameters.request.signal = signal;
        return request(parameters);
      }, parameters.request.signal),
    );
  }

  private async acquire(signal?: AbortSignal): Promise<void> {
    if (this.active < this.options.concurrency) {
      this.active++;
      return;
    }
    await new Promise<void>((resolve, reject) => {
      const start = () => {
        signal?.removeEventListener("abort", abort);
        resolve();
      };

      const abort = () => {
        const index = this.waiters.indexOf(start);
        if (index !== -1) {
          this.waiters.splice(index, 1);
        }
        reject(signal?.reason ?? new Error("Request cancelled."));
      };

      this.waiters.push(start);
      signal?.addEventListener("abort", abort, { once: true });
      if (signal?.aborted) {
        abort();
      }
    });
  }

  private release(): void {
    const next = this.waiters.shift();
    if (next) {
      next();
    } else {
      this.active--;
    }
  }

  async get(path: string, signal?: AbortSignal): Promise<unknown> {
    this.validatePath(path);
    const response = await this.api.request(`GET ${path}`, {
      request: signal ? { signal } : {},
    });
    if (typeof response.data !== "object" || response.data === null) {
      throw new ApiError(response.status, "INVALID_RESPONSE");
    }
    return response.data;
  }

  async *paginate(
    path: string,
    signal?: AbortSignal,
  ): AsyncGenerator<unknown[]> {
    this.validatePath(path);
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

  private validatePath(path: string): void {
    if (!path.startsWith("/") || path.startsWith("//") || path.includes("\\")) {
      throw new Error("Invalid API path.");
    }
  }

  private async requestWithPolicy<T>(
    request: (signal: AbortSignal) => Promise<T>,
    signal?: AbortSignal,
  ): Promise<T> {
    for (let attempt = 0; ; attempt++) {
      signal?.throwIfAborted();
      await this.acquire(signal);
      let failure: unknown;
      try {
        signal?.throwIfAborted();
        const timeout = AbortSignal.timeout(
          this.options.requestTimeoutSeconds * 1000,
        );
        const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;
        const result = await request(combined);
        combined.throwIfAborted();
        return result;
      } catch (error) {
        if (signal?.aborted) {
          signal.throwIfAborted();
        }
        failure = error;
      } finally {
        this.release();
      }
      const response =
        failure instanceof RequestError ? failure.response : undefined;
      const status = response?.status ?? 0;
      if (status === 401) {
        throw new FatalError(
          "AUTHENTICATION",
          "GitHub authentication is unusable.",
        );
      }
      const data: unknown = response?.data;
      if (
        status === 409 &&
        data &&
        typeof data === "object" &&
        "message" in data &&
        data.message === "Git Repository is empty."
      ) {
        throw new ApiError(409, "EMPTY_REPOSITORY");
      }
      const headers = response?.headers ?? {};
      const limited =
        status === 429 ||
        (status === 403 &&
          (headers["retry-after"] !== undefined ||
            headers["x-ratelimit-remaining"] === "0"));
      if (
        (status === 0 || limited || status >= 500) &&
        attempt < this.options.retries
      ) {
        const now = (this.options.now ?? Date.now)();
        const retry = headers["retry-after"] ?? null;
        const seconds = retry === null ? Number.NaN : Number(retry);
        const reset = Number(headers["x-ratelimit-reset"]) * 1000;
        const delay =
          retry !== null
            ? Number.isFinite(seconds)
              ? seconds * 1000
              : Date.parse(String(retry)) - now
            : limited && reset > now
              ? reset - now
              : 1000 * 2 ** attempt;
        if (!Number.isFinite(delay) || delay > 300_000) {
          throw new ApiError(status, "RATE_LIMIT");
        }
        await this.pause(Math.max(0, delay), signal);
        continue;
      }
      // Never propagate Octokit errors, raw responses, or request metadata.
      throw new ApiError(
        status,
        limited ? "RATE_LIMIT" : status === 0 ? "NETWORK" : "HTTP",
      );
    }
  }

  private async pause(
    milliseconds: number,
    signal?: AbortSignal,
  ): Promise<void> {
    if (this.options.sleep) {
      return this.options.sleep(milliseconds, signal);
    }
    await timersPromises.setTimeout(
      milliseconds,
      undefined,
      signal ? { signal } : {},
    );
  }
}
