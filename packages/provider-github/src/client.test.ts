import { expect, test, vi } from "vitest";
import { GitHubClient } from "./client.js";

const settings = {
  token: "private-token",
  concurrency: 2,
  retries: 2,
  requestTimeoutSeconds: 30,
};

test("honors Retry-After and never includes credentials in the URL", async () => {
  const transport = vi
    .fn<typeof fetch>()
    .mockResolvedValueOnce(
      new Response("", { status: 429, headers: { "retry-after": "2" } }),
    )
    .mockResolvedValueOnce(Response.json({ ok: true }));
  const sleep = vi.fn(async () => {});
  expect(
    await new GitHubClient({ ...settings, fetch: transport, sleep }).get(
      "/user",
    ),
  ).toEqual({ ok: true });
  expect(sleep).toHaveBeenCalledWith(2000, undefined);
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

test("bounds retries, cancellation, and excessively long server delays", async () => {
  const transport = vi
    .fn<typeof fetch>()
    .mockImplementation(async () => new Response("", { status: 503 }));
  await expect(
    new GitHubClient({
      ...settings,
      fetch: transport,
      sleep: async () => {},
    }).get("/x"),
  ).rejects.toThrow();
  expect(transport).toHaveBeenCalledTimes(3);
  await expect(
    new GitHubClient(settings).get("/x", AbortSignal.abort()),
  ).rejects.toThrow();
  await expect(
    new GitHubClient({
      ...settings,
      fetch: async () =>
        new Response("", { status: 429, headers: { "retry-after": "999999" } }),
    }).get("/x"),
  ).rejects.toThrow();
});

test("request concurrency stays within the configured limit", async () => {
  let active = 0;
  let maximum = 0;
  const client = new GitHubClient({
    ...settings,
    fetch: async () => {
      active++;
      maximum = Math.max(maximum, active);
      await new Promise((resolve) => setTimeout(resolve, 2));
      active--;
      return Response.json({});
    },
  });
  await Promise.all(Array.from({ length: 10 }, () => client.get("/x")));
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

test("Octokit network failures obey the configured retry budget and are sanitized", async () => {
  const transport = vi
    .fn<typeof fetch>()
    .mockRejectedValue(new Error("private-token network payload"));
  const client = new GitHubClient({
    ...settings,
    fetch: transport,
    sleep: async () => {},
  });
  await expect(client.get("/user")).rejects.toMatchObject({
    status: 0,
    code: "NETWORK",
    message: "GitHub request failed (NETWORK).",
  });
  expect(transport).toHaveBeenCalledTimes(3);
});

test("primary rate limits honor the reset time without retrying permission errors", async () => {
  const transport = vi
    .fn<typeof fetch>()
    .mockResolvedValueOnce(
      new Response("", {
        status: 403,
        headers: { "x-ratelimit-remaining": "0", "x-ratelimit-reset": "12" },
      }),
    )
    .mockResolvedValueOnce(Response.json({}));
  const sleep = vi.fn(async () => {});
  await new GitHubClient({
    ...settings,
    fetch: transport,
    sleep,
    now: () => 10_000,
  }).get("/user");
  expect(sleep).toHaveBeenCalledWith(2000, undefined);
  const forbidden = vi
    .fn<typeof fetch>()
    .mockResolvedValue(new Response("private-token", { status: 403 }));
  await expect(
    new GitHubClient({ ...settings, fetch: forbidden }).get("/user"),
  ).rejects.toMatchObject({ code: "HTTP" });
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

test("request timeouts remain bounded and consume only the configured retry budget", async () => {
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
    requestTimeoutSeconds: 0.01,
    retries: 1,
    fetch: transport,
    sleep: async () => {},
  });
  await expect(client.get("/user")).rejects.toMatchObject({ code: "NETWORK" });
  expect(transport).toHaveBeenCalledTimes(2);
});
