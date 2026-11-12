import { FatalError, type Policy, type Report } from "@kypa/sdk";
import { expect, test, vi } from "vitest";
import { type CliDependencies, run } from "./index.js";

const report = {
  run: { status: "partial" },
  scope: { evaluated: 1 },
  findings: [{}],
  errors: [{}],
} as Report;

function dependencies(): CliDependencies {
  return {
    load: vi.fn(async () => ({
      policy: {} as Policy,
      directory: "/tmp",
      digest: "digest",
    })),
    scan: vi.fn(async () => report),
    stdout: vi.fn(),
    stderr: vi.fn(),
  };
}

test("help works without a token or policy and performs no collection", async () => {
  const deps = dependencies();
  expect(await run(["--help"], {}, deps)).toBe(0);
  expect(deps.stdout).toHaveBeenCalledWith(
    expect.stringContaining("Usage: kypa"),
  );
  expect(deps.load).not.toHaveBeenCalled();
  expect(deps.scan).not.toHaveBeenCalled();
});

test.each([
  [
    [],
    { GH_TOKEN: "primary", GITHUB_TOKEN: "fallback" },
    "kypa.yaml",
    "primary",
  ],
  [
    ["--config", "policy.yaml"],
    { GITHUB_TOKEN: "fallback" },
    "policy.yaml",
    "fallback",
  ],
  [
    ["-c", "policy.yaml"],
    { GH_TOKEN: " ", GITHUB_TOKEN: "fallback" },
    "policy.yaml",
    "fallback",
  ],
] as const)(
  "loads the selected policy and environment token: %j",
  async (args, environment, config, token) => {
    const deps = dependencies();
    expect(await run([...args], environment, deps)).toBe(0);
    expect(deps.load).toHaveBeenCalledWith(config, expect.any(Array));
    expect(deps.scan).toHaveBeenCalledWith(
      {},
      "/tmp",
      "digest",
      token,
      undefined,
    );
    expect(deps.stdout).toHaveBeenCalledWith(
      expect.stringContaining("Status: partial"),
    );
    expect(deps.stderr).not.toHaveBeenCalled();
  },
);

test.each([
  ["never", 0],
  ["violation", 1],
  ["error", 1],
] as const)("maps fail-on %s to exit code %s", async (failOn, exitCode) => {
  expect(
    await run(
      ["--fail-on", failOn],
      { GH_TOKEN: "private-token" },
      dependencies(),
    ),
  ).toBe(exitCode);
});

test.each([
  ["--unknown", "private-token"],
  ["--config"],
  ["unexpected"],
  ["--fail-on", "invalid"],
  ["--token", "private-token"],
])(
  "invalid arguments fail before collection without echoing them: %j",
  async (...args: string[]) => {
    const deps = dependencies();
    expect(await run(args, { GH_TOKEN: "private-token" }, deps)).toBe(2);
    expect(deps.load).not.toHaveBeenCalled();
    expect(deps.scan).not.toHaveBeenCalled();
    expect(JSON.stringify(vi.mocked(deps.stderr).mock.calls)).not.toContain(
      "private-token",
    );
  },
);

test("missing authentication fails before loading a policy", async () => {
  const deps = dependencies();
  expect(await run([], {}, deps)).toBe(2);
  expect(deps.load).not.toHaveBeenCalled();
  expect(deps.stderr).toHaveBeenCalledWith(expect.stringContaining("GH_TOKEN"));
});

test.each([
  new Error("private-token payload"),
  new FatalError("AUTHENTICATION", "private-token payload"),
])("fatal failures emit safe diagnostics and always exit 2", async (error) => {
  const deps = dependencies();
  vi.mocked(deps.scan).mockRejectedValue(error);
  expect(await run([], { GH_TOKEN: "private-token" }, deps)).toBe(2);
  expect(deps.stdout).not.toHaveBeenCalled();
  expect(JSON.stringify(vi.mocked(deps.stderr).mock.calls)).not.toContain(
    "private-token",
  );
});

test("cancellation reaches the runner and returns a separate exit code", async () => {
  const deps = dependencies();
  const controller = new AbortController();
  vi.mocked(deps.scan).mockImplementation(
    async (_policy, _directory, _digest, _token, signal) => {
      expect(signal).toBe(controller.signal);
      controller.abort();
      signal?.throwIfAborted();
      return report;
    },
  );
  expect(
    await run([], { GH_TOKEN: "private-token" }, deps, controller.signal),
  ).toBe(130);
  expect(deps.stderr).toHaveBeenCalledWith("Scan cancelled.");
});
