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
  organizations: ["org"],
  repositories: [],
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
      path.includes("&page=1")
        ? Array.from({ length: 100 }, (_, i) => repository(i + 1))
        : [repository(101), repository(102, { archived: true })],
    ),
  );
  const provider = createGitHubProvider({ ...settings, fetch: request });
  const result = await provider.discover({
    ...targets,
    repositories: ["ORG/REPO-1"],
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
    organizations: [],
    repositories: ["org/fork", "org/missing"],
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
      organizations: [],
      repositories: ["org/repo-1"],
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
        organizations: [],
        repositories: ["org/repo-1"],
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
      organizations: [],
      repositories: ["org/repo-1"],
    })
  ).resources[0];
  if (!resource) {
    throw new Error("Missing fixture resource");
  }
  expect(
    (await provider.collect(resource, ["github/action-references@1"]))[
      "github/action-references@1"
    ]?.state,
  ).toBe("unavailable");
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
      organizations: [],
      repositories: ["org/repo-1"],
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
      organizations: [],
      repositories: ["org/repo-1"],
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
