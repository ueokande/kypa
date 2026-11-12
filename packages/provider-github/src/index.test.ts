import { expect, test, vi } from "vitest";
import { createGitHubProvider } from "./index.js";

const sha = "a".repeat(40);

const repository = (id = 1, overrides = {}) => ({
  id,
  full_name: `org/repo-${id}`,
  archived: false,
  fork: false,
  default_branch: "main",
  ...overrides,
});

const targets = {
  orgs: ["org"],
  repos: [],
  exclude: [],
  includeArchived: false,
  includeForks: false,
};
const settings = {
  token: "fixture-token",
  concurrency: 4,
  retries: 0,
  requestTimeoutSeconds: 30,
};

const transport =
  (route: (path: string) => unknown): typeof fetch =>
  async (input) => {
    const value = route(
      new URL(String(input)).pathname + new URL(String(input)).search,
    );
    return value instanceof Response ? value : Response.json(value);
  };

test("discovers more than 100 repositories with pagination, union deduplication, and filters", async () => {
  const request = vi.fn(
    transport((path) =>
      !path.includes("page=2")
        ? Response.json(
            Array.from({ length: 100 }, (_, i) => repository(i + 1)),
            {
              headers: {
                link: '<https://api.github.com/orgs/org/repos?type=all&per_page=100&page=2>; rel="next"',
              },
            },
          )
        : [repository(101), repository(102, { archived: true })],
    ),
  );
  const provider = createGitHubProvider({ ...settings, fetch: request });
  const result = await provider.discover({
    ...targets,
    repos: ["ORG/REPO-1"],
    exclude: ["org/repo-2"],
  });
  expect(result.resources).toHaveLength(100);
  expect(result.excluded).toEqual(["org/repo-2", "org/repo-102"]);
  expect(request).toHaveBeenCalledTimes(2);
});

test("explicit targets have the same archive/fork filters; inaccessible targets leave coverage errors", async () => {
  const provider = createGitHubProvider({
    ...settings,
    fetch: transport((path) =>
      path.includes("missing")
        ? new Response("", { status: 404 })
        : repository(1, { fork: true }),
    ),
  });
  const result = await provider.discover({
    ...targets,
    orgs: [],
    repos: ["org/fork", "org/missing"],
  });
  expect(result.resources).toEqual([]);
  expect(result.excluded).toHaveLength(1);
  expect(result.errors).toHaveLength(1);
});

test("collects default-branch references at a resolved commit, without raw file contents in evidence", async () => {
  const source =
    "jobs:\n  test:\n    steps:\n      - uses: actions/checkout@v4\n";
  const provider = createGitHubProvider({
    ...settings,
    fetch: transport((path) => {
      if (path === "/repos/org/repo-1") {
        return repository();
      }
      if (path.includes("/commits/")) {
        return { sha, commit: { tree: { sha } } };
      }
      if (path.includes("/git/trees/")) {
        return {
          truncated: false,
          tree: [
            {
              path: ".github/workflows/ci.yml",
              type: "blob",
              mode: "100644",
              sha,
            },
          ],
        };
      }
      if (path.includes("/git/blobs/")) {
        return {
          encoding: "base64",
          content: Buffer.from(source).toString("base64"),
          size: source.length,
        };
      }
      throw new Error(`Unexpected fixture request: ${path}`);
    }),
  });
  const resource = (
    await provider.discover({
      ...targets,
      orgs: [],
      repos: ["org/repo-1"],
    })
  ).resources[0];
  expect(resource).toBeDefined();
  if (!resource) {
    return;
  }
  const evidence = await provider.collect(resource, [
    "github/action-references@1",
  ]);
  expect(evidence["github/action-references@1"]?.state).toBe("available");
  expect(resource.metadata.scannedCommit).toBe(sha);
  expect(JSON.stringify(evidence)).not.toContain("steps:");
  expect(JSON.stringify(evidence)).not.toContain("fixture-token");
});

test.each([false, true])(
  "protection 404 requires established unprotected branch evidence (%s)",
  async (admin) => {
    const provider = createGitHubProvider({
      ...settings,
      fetch: transport((path) => {
        if (path.includes("/commits/")) {
          return { sha, commit: { tree: { sha } } };
        }
        if (path.endsWith("/branches/main")) {
          return { protected: !admin };
        }
        if (path.includes("/protection")) {
          return new Response("", { status: 404 });
        }
        return repository(1, { permissions: { admin } });
      }),
    });
    const resource = (
      await provider.discover({
        ...targets,
        orgs: [],
        repos: ["org/repo-1"],
      })
    ).resources[0];
    if (!resource) {
      throw new Error("Missing fixture resource");
    }
    const evidence = await provider.collect(resource, [
      "github/classic-protection@1",
    ]);
    expect(evidence["github/classic-protection@1"]?.state).toBe(
      admin ? "available" : "unavailable",
    );
  },
);

test("truncated trees cannot become successful empty evaluations", async () => {
  const provider = createGitHubProvider({
    ...settings,
    fetch: transport((path) => {
      if (path.includes("/commits/")) {
        return { sha, commit: { tree: { sha } } };
      }
      if (path.includes("/trees/")) {
        return { truncated: true, tree: [] };
      }
      return repository();
    }),
  });
  const resource = (
    await provider.discover({
      ...targets,
      orgs: [],
      repos: ["org/repo-1"],
    })
  ).resources[0];
  if (!resource) {
    throw new Error("Missing fixture resource");
  }
  expect(
    (await provider.collect(resource, ["github/action-references@1"]))[
      "github/action-references@1"
    ],
  ).toMatchObject({ state: "unavailable", code: "TRUNCATED_TREE" });
});

test("confirmed empty Git repositories are not applicable despite a default branch name", async () => {
  const provider = createGitHubProvider({
    ...settings,
    fetch: transport((path) =>
      path.includes("/commits/")
        ? Response.json(
            { message: "Git Repository is empty." },
            { status: 409 },
          )
        : repository(),
    ),
  });
  const resource = (
    await provider.discover({
      ...targets,
      orgs: [],
      repos: ["org/repo-1"],
    })
  ).resources[0];
  if (!resource) {
    throw new Error("Missing fixture resource");
  }
  expect(
    (await provider.collect(resource, ["github/action-references@1"]))[
      "github/action-references@1"
    ]?.state,
  ).toBe("not-applicable");
});

test("identical file blobs share one request while preserving separate file locations", async () => {
  let requests = 0;
  const source =
    "jobs:\n  check:\n    steps:\n      - uses: actions/checkout@v6\n";
  const provider = createGitHubProvider({
    ...settings,
    fetch: transport((path) => {
      if (path.includes("/commits/")) {
        return { sha, commit: { tree: { sha } } };
      }
      if (path.includes("/trees/")) {
        return {
          truncated: false,
          tree: ["one", "two"].map((name) => ({
            path: `.github/workflows/${name}.yml`,
            type: "blob",
            mode: "100644",
            sha,
          })),
        };
      }
      if (path.includes("/blobs/")) {
        requests++;
        return {
          encoding: "base64",
          content: Buffer.from(source).toString("base64"),
          size: source.length,
        };
      }
      return repository();
    }),
  });
  const resource = (
    await provider.discover({
      ...targets,
      orgs: [],
      repos: ["org/repo-1"],
    })
  ).resources[0];
  if (!resource) {
    throw new Error("Missing fixture resource");
  }
  const evidence = (
    await provider.collect(resource, ["github/action-references@1"])
  )["github/action-references@1"];
  expect(evidence?.state).toBe("available");
  expect(requests).toBe(1);
  if (evidence?.state === "available") {
    expect(
      (evidence.data as { references: unknown[] }).references,
    ).toHaveLength(2);
  }
});

test.each([403, 404, 429, 503])(
  "organization discovery explains HTTP %s without exposing response bodies",
  async (status) => {
    const provider = createGitHubProvider({
      ...settings,
      fetch: async () =>
        Response.json(
          { message: "fixture-token private response" },
          { status },
        ),
    });
    const result = await provider.discover(targets);
    expect(result.errors[0]?.code).toContain(`GITHUB_${status}_`);
    expect(result.errors[0]?.message).toContain(String(status));
    expect(JSON.stringify(result)).not.toContain("fixture-token");
    if (status === 404) {
      expect(result.errors[0]?.message).toContain("personal account");
      expect(result.errors[0]?.message).toContain("targets.repos");
    }
  },
);

test("a later discovery page failure preserves already discovered resources and missing coverage", async () => {
  const provider = createGitHubProvider({
    ...settings,
    fetch: transport((path) =>
      path.includes("page=2")
        ? new Response("", { status: 409 })
        : Response.json([repository()], {
            headers: {
              link: '<https://api.github.com/orgs/org/repos?page=2>; rel="next"',
            },
          }),
    ),
  });
  const result = await provider.discover(targets);
  expect(result.resources).toHaveLength(1);
  expect(result.errors[0]?.code).toBe("GITHUB_409_HTTP");
});

test("omitted review requirements in classic protection mean zero required reviews", async () => {
  const provider = createGitHubProvider({
    ...settings,
    fetch: transport((path) => {
      if (path.includes("/commits/")) {
        return { sha, commit: { tree: { sha } } };
      }
      if (path.endsWith("/protection")) {
        return { enforce_admins: { enabled: true } };
      }
      return repository();
    }),
  });
  const [resource] = (
    await provider.discover({ ...targets, orgs: [], repos: ["org/repo-1"] })
  ).resources;
  expect(resource).toBeDefined();
  if (!resource) {
    throw new Error("Missing fixture resource.");
  }
  const evidence = await provider.collect(resource, [
    "github/classic-protection@1",
  ]);
  expect(evidence["github/classic-protection@1"]).toMatchObject({
    state: "available",
    data: { minimum: 0 },
  });
});

test("a file error cannot hide a concurrent fatal authentication failure", async () => {
  const other = "b".repeat(40);
  const provider = createGitHubProvider({
    ...settings,
    fetch: transport((path) => {
      if (path.includes("/commits/")) {
        return { sha, commit: { tree: { sha } } };
      }
      if (path.includes("/trees/")) {
        return {
          truncated: false,
          tree: [sha, other].map((id, index) => ({
            path: `.github/workflows/${index}.yml`,
            sha: id,
            type: "blob",
            mode: "100644",
          })),
        };
      }
      if (path.includes(`/blobs/${sha}`)) {
        return new Response("private source", { status: 404 });
      }
      if (path.includes(`/blobs/${other}`)) {
        return new Response("private token", { status: 401 });
      }
      return repository();
    }),
  });
  const [resource] = (
    await provider.discover({ ...targets, orgs: [], repos: ["org/repo-1"] })
  ).resources;
  if (!resource) {
    throw new Error("Missing fixture resource.");
  }
  await expect(
    provider.collect(resource, ["github/action-references@1"]),
  ).rejects.toMatchObject({ code: "AUTHENTICATION" });
});

test("case-insensitive duplicate inaccessible targets are requested and reported once", async () => {
  const request = vi
    .fn<typeof fetch>()
    .mockImplementation(async () => new Response("", { status: 404 }));
  const provider = createGitHubProvider({ ...settings, fetch: request });
  const result = await provider.discover({
    ...targets,
    orgs: [],
    repos: ["org/missing", "ORG/MISSING"],
  });
  expect(request).toHaveBeenCalledTimes(1);
  expect(result.errors).toHaveLength(1);
});
