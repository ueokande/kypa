import { FatalError, type ScanSettings } from '@kypa/sdk';
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
  constructor(private readonly options: ClientOptions) {}
  private async acquire(): Promise<void> {
    if (this.active < this.options.concurrency) {
      this.active++;
      return;
    }
    await new Promise<void>((resolve) => this.waiters.push(resolve));
  }
  private release(): void {
    const next = this.waiters.shift();
    if (next) next();
    else this.active--;
  }
  async get(path: string, signal?: AbortSignal): Promise<unknown> {
    if (!path.startsWith('/') || path.startsWith('//'))
      throw new Error('Invalid API path.');
    for (let attempt = 0; ; attempt++) {
      signal?.throwIfAborted();
      await this.acquire();
      let response: Response;
      try {
        const timeout = AbortSignal.timeout(
          this.options.requestTimeoutSeconds * 1000,
        );
        response = await (this.options.fetch ?? fetch)(
          `https://api.github.com${path}`,
          {
            headers: {
              Authorization: `Bearer ${this.options.token}`,
              Accept: 'application/vnd.github+json',
              'X-GitHub-Api-Version': '2022-11-28',
            },
            signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
            redirect: 'error',
          },
        );
      } catch {
        if (signal?.aborted) signal.throwIfAborted();
        if (attempt >= this.options.retries) throw new ApiError(0, 'NETWORK');
        await this.pause(1000 * 2 ** attempt, signal);
        continue;
      } finally {
        this.release();
      }
      if (response.status === 401)
        throw new FatalError(
          'AUTHENTICATION',
          'GitHub authentication is unusable.',
        );
      if (response.ok) {
        try {
          return await response.json();
        } catch {
          throw new ApiError(response.status, 'INVALID_RESPONSE');
        }
      }
      // Consume the body without exposing it to rules, reports, or logs.
      const body = await response.text();
      if (response.status === 409) {
        try {
          const data: unknown = JSON.parse(body);
          if (
            data &&
            typeof data === 'object' &&
            'message' in data &&
            data.message === 'Git Repository is empty.'
          )
            throw new ApiError(409, 'EMPTY_REPOSITORY');
        } catch (error) {
          if (error instanceof ApiError) throw error;
        }
      }
      const limited =
        response.status === 429 ||
        (response.status === 403 &&
          (response.headers.has('retry-after') ||
            response.headers.get('x-ratelimit-remaining') === '0'));
      if (
        (limited || response.status >= 500) &&
        attempt < this.options.retries
      ) {
        const now = (this.options.now ?? Date.now)();
        const retry = response.headers.get('retry-after');
        const seconds = retry === null ? Number.NaN : Number(retry);
        const reset = Number(response.headers.get('x-ratelimit-reset')) * 1000;
        const delay =
          retry !== null
            ? Number.isFinite(seconds)
              ? seconds * 1000
              : Date.parse(retry) - now
            : limited && reset > now
              ? reset - now
              : 1000 * 2 ** attempt;
        if (!Number.isFinite(delay) || delay > 300_000)
          throw new ApiError(response.status, 'RATE_LIMIT');
        await this.pause(Math.max(0, delay), signal);
        continue;
      }
      throw new ApiError(response.status, limited ? 'RATE_LIMIT' : 'HTTP');
    }
  }
  private async pause(
    milliseconds: number,
    signal?: AbortSignal,
  ): Promise<void> {
    if (this.options.sleep) return this.options.sleep(milliseconds, signal);
    const { setTimeout } = await import('node:timers/promises');
    await setTimeout(milliseconds, undefined, signal ? { signal } : {});
  }
}
