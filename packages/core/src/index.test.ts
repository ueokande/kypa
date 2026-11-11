import type { Policy, Provider, Reporter, Resource, Rule } from "@kypa/sdk";
import { shouldFail } from "@kypa/sdk";
import { expect, test, vi } from "vitest";
import { runScan } from "./index.js";

const resource: Resource = {
  provider: "example",
  type: "project",
  id: "1",
  name: "a",
  url: "",
  metadata: {},
};
const policy: Policy = {
  version: 1,
  targets: {
    organizations: [],
    repositories: ["org/repo"],
    exclude: [],
    includeArchived: false,
    includeForks: false,
  },
  scan: { concurrency: 4, retries: 3, requestTimeoutSeconds: 30 },
  rules: [{ id: "test", severity: "high", parameters: {} }],
  reporters: [{ name: "test", options: {} }],
};
const rule: Rule = {
  id: "test",
  version: "1",
  resourceTypes: ["example/project"],
  requiredEvidence: ["example/config@1"],
  defaultSeverity: "high",
  validateParameters: (input) => input,
  evaluate: () => ({
    applicable: true,
    findings: [{ key: "key", message: "Violation", remediation: "Fix" }],
  }),
};
const provider: Provider = {
  id: "example",
  discover: async () => ({
    resources: [structuredClone(resource)],
    errors: [],
    excluded: [],
  }),
  collect: async () => ({
    "example/config@1": { state: "available", observedAt: "", data: {} },
  }),
};
const reporter: Reporter = { id: "test", write: vi.fn(async () => {}) };

const run = (extra: Partial<Parameters<typeof runScan>[1]> = {}) =>
  runScan(policy, {
    provider,
    rules: [rule],
    reporters: [reporter],
    policyDirectory: "",
    policyDigest: "digest",
    now: () => new Date("2026-01-01T00:00:00Z"),
    runId: () => "fixture",
    ...extra,
  });

test("generic resource evaluation generates findings, stable identity, and reports despite violations", async () => {
  const report = await run();
  const again = await run();
  expect(report.evaluations[0]?.status).toBe("fail");
  expect(report.run.status).toBe("complete");
  expect(report.findings[0]?.id).toBe(again.findings[0]?.id);
  expect(reporter.write).toHaveBeenCalled();
  expect(shouldFail(report, "never")).toBe(false);
  expect(shouldFail(report, "violation")).toBe(true);
  expect(shouldFail(report, "error")).toBe(false);
});

test("missing evidence produces partial coverage even with zero findings", async () => {
  const report = await run({
    provider: { ...provider, collect: async () => ({}) },
  });
  expect(report.evaluations[0]?.status).toBe("error");
  expect(report.findings).toEqual([]);
  expect(report.run.status).toBe("partial");
  expect(shouldFail(report, "error")).toBe(true);
});

test("evaluation errors are safe and not passes", async () => {
  const report = await run({
    rules: [
      {
        ...rule,
        evaluate: () => {
          throw new Error("secret raw payload");
        },
      },
    ],
  });
  expect(JSON.stringify(report)).not.toContain("secret raw payload");
  expect(report.evaluations[0]?.status).toBe("error");
});

test("empty effective scope, duplicate registries, reporter failure and cancellation are fatal", async () => {
  await expect(
    run({
      provider: {
        ...provider,
        discover: async () => ({ resources: [], errors: [], excluded: [] }),
      },
    }),
  ).rejects.toThrow("No effective");
  await expect(run({ rules: [rule, rule] })).rejects.toThrow("Duplicate");
  await expect(
    run({
      reporters: [
        {
          ...reporter,
          write: async () => {
            throw new Error("disk full");
          },
        },
      ],
    }),
  ).rejects.toThrow("Reporter failed");
  await expect(run({ signal: AbortSignal.abort() })).rejects.toThrow();
});

test("failed discovery with no visible resources is a partial report, not an empty-target success", async () => {
  const report = await run({
    provider: {
      ...provider,
      discover: async () => ({
        resources: [],
        errors: [
          { phase: "discovery", code: "ACCESS", message: "Missing coverage" },
        ],
        excluded: [],
      }),
    },
  });
  expect(report.run.status).toBe("partial");
  expect(report.scope.evaluated).toBe(0);
});

test("collector faults produce a safe partial report and preserve evidence observation times", async () => {
  const report = await run({
    provider: {
      ...provider,
      collect: async () => {
        throw new Error("sensitive collector context");
      },
    },
  });
  expect(report.run.status).toBe("partial");
  expect(report.evaluations[0]?.evidence).toEqual([
    {
      id: "example/config@1",
      state: "unavailable",
      observedAt: "2026-01-01T00:00:00.000Z",
    },
  ]);
  expect(JSON.stringify(report)).not.toContain("sensitive collector context");
});
