import { afterEach, expect, test, vi } from "vitest";
import { GitHubClient } from "./client.js";

afterEach(() => {
  vi.useRealTimers();
});

const settings = {
  token: "private-token",
  concurrency: 2,
  retries: 2,
  requestTimeoutSeconds: 30,
};

test("Octokit honors secondary rate-limit Retry-After without putting credentials in the URL", async () => {
  vi.useFakeTimers();
  const transport = vi
    .fn<typeof fetch>()
    .mockResolvedValueOnce(
      Response.json(
        { message: "You have exceeded a secondary rate limit." },
        { status: 429, headers: { "retry-after": "2" } },
      ),
    )
    .mockResolvedValueOnce(Response.json({ ok: true }));
  const result = expect(
    new GitHubClient({ ...settings, fetch: transport }).get("/user"),
  ).resolves.toEqual({ ok: true });
  await vi.advanceTimersByTimeAsync(2100);
  await result;
  expect(transport).toHaveBeenCalledTimes(2);
  expect(transport.mock.calls[0]?.[0]).toBe("https://api.github.com/user");
});

test("401 is fatal; 404 is not retried and cannot expose response text", async () => {
  const unauthorized = new GitHubClient({
    ...settings,
    fetch: vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response("token private-token", { status: 401 })),
  });
  await expect(unauthorized.get("/user")).rejects.toThrow("authentication");
  const transport = vi
    .fn<typeof fetch>()
    .mockResolvedValue(new Response("secret payload", { status: 404 }));
  await expect(
    new GitHubClient({ ...settings, fetch: transport }).get("/x"),
  ).rejects.toThrow("GitHub request failed");
  expect(transport).toHaveBeenCalledTimes(1);
});

test("Octokit bounds server retries and declines excessively long rate-limit delays", async () => {
  vi.useFakeTimers();
  const transport = vi
    .fn<typeof fetch>()
    .mockImplementation(async () => new Response("", { status: 503 }));
  const result = expect(
    new GitHubClient({ ...settings, fetch: transport }).get("/x"),
  ).rejects.toMatchObject({ status: 503, code: "HTTP" });
  await vi.advanceTimersByTimeAsync(6000);
  await result;
  expect(transport).toHaveBeenCalledTimes(3);
  const limited = vi
    .fn<typeof fetch>()
    .mockImplementation(async () =>
      Response.json(
        { message: "You have exceeded a secondary rate limit." },
        { status: 429, headers: { "retry-after": "999999" } },
      ),
    );
  const rejected = expect(
    new GitHubClient({ ...settings, fetch: limited }).get("/x"),
  ).rejects.toMatchObject({ code: "RATE_LIMIT" });
  await vi.advanceTimersByTimeAsync(100);
  await rejected;
  expect(limited).toHaveBeenCalledTimes(1);
});

test("requests cancelled before submission never reach the transport", async () => {
  const transport = vi.fn<typeof fetch>();
  await expect(
    new GitHubClient({ ...settings, fetch: transport }).get(
      "/x",
      AbortSignal.abort(),
    ),
  ).rejects.toThrow();
  expect(transport).not.toHaveBeenCalled();
});

test("concurrent callers stay within the configured limit without serializing every request", async () => {
  let release: (() => void) | undefined;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let active = 0;
  let maximum = 0;
  const client = new GitHubClient({
    ...settings,
    fetch: async () => {
      active++;
      maximum = Math.max(maximum, active);
      await gate;
      active--;
      return Response.json({});
    },
  });
  const pending = Promise.all(
    Array.from({ length: 10 }, () => client.get("/x")),
  );
  await vi.waitFor(() => expect(active).toBe(2));
  release?.();
  await pending;
  expect(maximum).toBe(2);
});

test("queued requests cancel without waiting for an occupied request slot", async () => {
  let release: (() => void) | undefined;
  const client = new GitHubClient({
    ...settings,
    concurrency: 1,
    fetch: async () => {
      await new Promise<void>((resolve) => {
        release = resolve;
      });
      return Response.json({});
    },
  });
  const first = client.get("/first");
  await vi.waitFor(() => expect(release).toBeDefined());
  const controller = new AbortController();
  const second = client.get("/second", controller.signal);
  controller.abort();
  await expect(second).rejects.toThrow();
  release?.();
  await first;
});

test("the concurrency limit covers response body consumption as well as headers", async () => {
  let active = 0;
  let maximum = 0;
  const client = new GitHubClient({
    ...settings,
    fetch: async () => {
      active++;
      maximum = Math.max(maximum, active);
      return new Response(
        new ReadableStream({
          start(controller) {
            setTimeout(() => {
              controller.enqueue(new TextEncoder().encode("{}"));
              controller.close();
              active--;
            }, 5);
          },
        }),
        { headers: { "content-type": "application/json" } },
      );
    },
  });
  await Promise.all(Array.from({ length: 8 }, () => client.get("/x")));
  expect(maximum).toBe(2);
});

test("Octokit supplies authentication and API headers without allowing redirects", async () => {
  const transport = vi.fn<typeof fetch>().mockResolvedValue(Response.json({}));
  await new GitHubClient({ ...settings, fetch: transport }).get("/user");
  const headers = new Headers(transport.mock.calls[0]?.[1]?.headers);
  expect(headers.get("authorization")).toBe("token private-token");
  expect(headers.get("accept")).toBe("application/vnd.github.v3+json");
  expect(headers.get("x-github-api-version")).toBe("2022-11-28");
  expect(transport.mock.calls[0]?.[1]?.redirect).toBe("error");
});

test("malformed JSON responses cannot become successful evidence or expose payloads", async () => {
  const client = new GitHubClient({
    ...settings,
    fetch: async () =>
      new Response("private-token invalid JSON", {
        headers: { "content-type": "application/json" },
      }),
  });
  await expect(client.get("/user")).rejects.toMatchObject({
    status: 200,
    code: "INVALID_RESPONSE",
    message: "GitHub request failed (INVALID_RESPONSE).",
  });
});

test("Octokit network failures obey its retry budget and are sanitized", async () => {
  vi.useFakeTimers();
  const transport = vi
    .fn<typeof fetch>()
    .mockRejectedValue(new Error("private-token network payload"));
  const result = expect(
    new GitHubClient({ ...settings, fetch: transport }).get("/user"),
  ).rejects.toMatchObject({
    status: 0,
    code: "NETWORK",
    message: "GitHub request failed (NETWORK).",
  });
  await vi.advanceTimersByTimeAsync(6000);
  await result;
  expect(transport).toHaveBeenCalledTimes(3);
});

test("Octokit handles primary rate-limit resets without retrying permission errors", async () => {
  vi.useFakeTimers();
  const transport = vi
    .fn<typeof fetch>()
    .mockResolvedValueOnce(
      new Response("", {
        status: 403,
        headers: {
          "x-ratelimit-remaining": "0",
          "x-ratelimit-reset": String(Math.floor(Date.now() / 1000) + 2),
        },
      }),
    )
    .mockResolvedValueOnce(Response.json({}));
  const result = expect(
    new GitHubClient({ ...settings, fetch: transport }).get("/user"),
  ).resolves.toEqual({});
  await vi.advanceTimersByTimeAsync(4000);
  await result;
  expect(transport).toHaveBeenCalledTimes(2);
  const forbidden = vi
    .fn<typeof fetch>()
    .mockResolvedValue(new Response("private-token", { status: 403 }));
  const denied = expect(
    new GitHubClient({ ...settings, fetch: forbidden }).get("/user"),
  ).rejects.toMatchObject({ code: "HTTP" });
  await vi.advanceTimersByTimeAsync(100);
  await denied;
  expect(forbidden).toHaveBeenCalledTimes(1);
});

test("pagination preserves cancellation for subsequent page requests", async () => {
  const controller = new AbortController();
  const transport = vi.fn<typeof fetch>().mockResolvedValue(
    Response.json([{}], {
      headers: {
        link: '<https://api.github.com/orgs/org/repos?page=2>; rel="next"',
      },
    }),
  );
  const pages = new GitHubClient({ ...settings, fetch: transport }).paginate(
    "/orgs/org/repos",
    controller.signal,
  );
  expect((await pages.next()).value).toEqual([{}]);
  controller.abort();
  await expect(pages.next()).rejects.toThrow();
  expect(transport).toHaveBeenCalledTimes(1);
});

test("pagination never sends credentials to an external next-page URL", async () => {
  const transport = vi.fn<typeof fetch>().mockResolvedValue(
    Response.json([{}], {
      headers: { link: '<https://example.com/repos?page=2>; rel="next"' },
    }),
  );
  const pages = new GitHubClient({
    ...settings,
    retries: 0,
    fetch: transport,
  }).paginate("/orgs/org/repos");
  await pages.next();
  await expect(pages.next()).rejects.toMatchObject({ code: "NETWORK" });
  expect(transport).toHaveBeenCalledTimes(1);
});

test("queue timeouts abort the transport without retrying cancelled work", async () => {
  const transport = vi
    .fn<typeof fetch>()
    .mockImplementation(async (_input, init) => {
      await new Promise((_, reject) => {
        init?.signal?.addEventListener(
          "abort",
          () => reject(init.signal?.reason),
          { once: true },
        );
      });
      return Response.json({});
    });
  const client = new GitHubClient({
    ...settings,
    requestTimeoutSeconds: 0.1,
    retries: 1,
    fetch: transport,
  });
  await expect(client.get("/user")).rejects.toMatchObject({ code: "TIMEOUT" });
  expect(transport).toHaveBeenCalledTimes(1);
});

test("request failures release the queue for other callers", async () => {
  const transport = vi
    .fn<typeof fetch>()
    .mockResolvedValueOnce(new Response("private-token", { status: 404 }))
    .mockResolvedValueOnce(Response.json({ ok: true }));
  const client = new GitHubClient({
    ...settings,
    concurrency: 1,
    fetch: transport,
  });
  const results = await Promise.allSettled([
    client.get("/missing"),
    client.get("/user"),
  ]);
  expect(results[0]).toMatchObject({
    status: "rejected",
    reason: { code: "HTTP" },
  });
  expect(results[1]).toEqual({ status: "fulfilled", value: { ok: true } });
});

test("cancelling in-flight work aborts its transport and leaves other callers usable", async () => {
  const controller = new AbortController();
  let cancelled = false;
  const transport = vi
    .fn<typeof fetch>()
    .mockImplementation(async (input, init) => {
      if (String(input).endsWith("/blocked")) {
        await new Promise<void>((_resolve, reject) => {
          init?.signal?.addEventListener(
            "abort",
            () => {
              cancelled = true;
              reject(init.signal?.reason);
            },
            { once: true },
          );
        });
      }
      return Response.json({ ok: true });
    });
  const client = new GitHubClient({
    ...settings,
    concurrency: 1,
    fetch: transport,
  });
  const first = expect(
    client.get("/blocked", controller.signal),
  ).rejects.toThrow();
  await vi.waitFor(() => expect(transport).toHaveBeenCalledTimes(1));
  const second = client.get("/user");
  controller.abort();
  await first;
  await expect(second).resolves.toEqual({ ok: true });
  expect(cancelled).toBe(true);
  expect(transport).toHaveBeenCalledTimes(2);
});

test("cancelled rate-limit retries never send another request", async () => {
  vi.useFakeTimers();
  const controller = new AbortController();
  const transport = vi.fn<typeof fetch>().mockImplementation(async () =>
    Response.json(
      {
        message: "You have exceeded a secondary rate limit.",
      },
      { status: 429, headers: { "retry-after": "2" } },
    ),
  );
  const first = expect(
    new GitHubClient({ ...settings, fetch: transport }).get(
      "/user",
      controller.signal,
    ),
  ).rejects.toThrow();
  await vi.advanceTimersByTimeAsync(100);
  expect(transport).toHaveBeenCalledTimes(1);
  controller.abort();
  await first;
  await vi.advanceTimersByTimeAsync(10_000);
  expect(transport).toHaveBeenCalledTimes(1);
});

test("operation timeouts also bound Octokit's rate-limit waits", async () => {
  vi.useFakeTimers();
  const transport = vi.fn<typeof fetch>().mockImplementation(async () =>
    Response.json(
      {
        message: "You have exceeded a secondary rate limit.",
      },
      { status: 429, headers: { "retry-after": "2" } },
    ),
  );
  const result = expect(
    new GitHubClient({
      ...settings,
      requestTimeoutSeconds: 0.1,
      fetch: transport,
    }).get("/user"),
  ).rejects.toMatchObject({ code: "TIMEOUT" });
  await vi.advanceTimersByTimeAsync(200);
  await result;
  await vi.advanceTimersByTimeAsync(10_000);
  expect(transport).toHaveBeenCalledTimes(1);
});

test("pagination HTTP 409 is an error rather than a successful empty listing", async () => {
  const transport = vi
    .fn<typeof fetch>()
    .mockImplementation(
      async () => new Response("private-token", { status: 409 }),
    );
  const pages = new GitHubClient({
    ...settings,
    retries: 0,
    fetch: transport,
  }).paginate("/orgs/org/repos");
  await expect(pages.next()).rejects.toMatchObject({
    status: 409,
    code: "HTTP",
  });
  expect(transport).toHaveBeenCalledTimes(1);
});

test("paginated endpoints reject objects that are not repository lists", async () => {
  const pages = new GitHubClient({
    ...settings,
    fetch: async () => Response.json({ unexpected: true }),
  }).paginate("/orgs/org/repos");
  await expect(pages.next()).rejects.toMatchObject({
    code: "INVALID_RESPONSE",
  });
});
