import * as fsPromises from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { formatFailure, type Rule } from "@kypa/sdk";
import { afterEach, expect, test } from "vitest";
import { z } from "zod";
import { loadPolicy, matchesPattern, parsePolicy } from "./config.js";

const rule: Rule = {
  id: "test/rule",
  version: "1",
  resourceTypes: ["github/repository"],
  requiredEvidence: [],
  defaultSeverity: "high",
  validateParameters: (input) => input,
  evaluate: () => ({ applicable: true, findings: [] }),
};
const source = `version: 1
targets:
  repos: [org/repo]
rules:
  test/rule: {}
reporters:
  - name: json
    options: {path: report/report.json}
`;
const directories: string[] = [];
afterEach(async () => {
  await Promise.all(
    directories
      .splice(0)
      .map((directory) =>
        fsPromises.rm(directory, { recursive: true, force: true }),
      ),
  );
});

test("defaults collection controls and rule settings", () => {
  const policy = parsePolicy(source, [rule]);
  expect(policy.scan).toEqual({
    concurrency: 4,
    retries: 3,
    requestTimeoutSeconds: 30,
  });
  expect(policy.rules[0]?.severity).toBe("high");
  expect(policy.targets.includeArchived).toBe(false);
});

test.each([
  source.replace("version: 1", "version: 1\nversion: 1"),
  `${source}exceptions: []\n`,
  `${source}plugins: []\n`,
  source.replace("test/rule: {}", "test/unknown: {}"),
  source.replace("test/rule: {}", "test/rule: {enabled: false}"),
  source.replace("[org/repo]", "[]"),
  source.replace(
    "path: report/report.json",
    "path: report/report.json, extra: true",
  ),
])("rejects unknown and duplicate keys and invalid policy", (text) => {
  expect(() => parsePolicy(text, [rule])).toThrow();
});

test("patterns are case-insensitive, escape dots, and cannot cross owner boundaries", () => {
  expect(matchesPattern("Org/service.api", "org/service.*")).toBe(true);
  expect(matchesPattern("org/serviceXapi", "org/service.api")).toBe(false);
  expect(matchesPattern("org/nested/name", "org/*")).toBe(false);
});

test("rejects overlapping, existing, escaping, and symlink output destinations", async () => {
  const directory = await fsPromises.mkdtemp(
    path.join(os.tmpdir(), "kypa-config-"),
  );
  directories.push(directory);
  const file = path.join(directory, "policy.yaml");

  const check = async (text: string) => {
    await fsPromises.writeFile(file, text);
    return loadPolicy(file, [rule]);
  };

  await expect(check(source)).resolves.toMatchObject({ directory });
  await expect(
    check(source.replace("report/report.json", "../outside.json")),
  ).rejects.toThrow();
  await expect(
    check(source.replace("report/report.json", "policy.yaml")),
  ).rejects.toThrow();
  await expect(
    check(
      `${source}  - name: html\n    options: {directory: report, basePath: /}\n`,
    ),
  ).rejects.toThrow();
  await fsPromises.mkdir(path.join(directory, "report"));
  await fsPromises.writeFile(
    path.join(directory, "report/report.json"),
    "existing",
  );
  await expect(check(source)).rejects.toThrow();
  await fsPromises.symlink(os.tmpdir(), path.join(directory, "escape"));
  await expect(
    check(source.replace("report/report.json", "escape/new.json")),
  ).rejects.toThrow();
});

function diagnostic(text: string, rules: readonly Rule[] = [rule]): string {
  try {
    parsePolicy(text, rules);
  } catch (error) {
    return formatFailure(error);
  }
  throw new Error("Expected invalid configuration.");
}

test("HTML basePath errors identify the reporter and explain the URL path format", () => {
  const message = diagnostic(
    `${source}  - name: html\n    options: {directory: site, basePath: ./private-token}\n`,
  );
  expect(message).toContain("reporters[1].options.basePath");
  expect(message).toContain('such as "/" or "/report/"');
  expect(message).not.toContain("private-token");
});

test.each([
  source.replace("repos: [org/repo]", "repos: private-token"),
  source.replace("test/rule: {}", "private-token: {severity: invalid}"),
  `${source}private-token: value\n`,
  source.replace(
    "path: report/report.json",
    "path: report/report.json, private-token: true",
  ),
  source.replace("test/rule", "private-token"),
])(
  "configuration diagnostics never echo values, record keys, or unknown fields",
  (text) => {
    const message = diagnostic(text);
    expect(message).toContain("Kypa failed (CONFIG)");
    expect(message).not.toContain("private-token");
  },
);

test("YAML errors show line and column without quoting the source", () => {
  const message = diagnostic(`${source}private-token: [\n`);
  expect(message).toMatch(/line \d+, column \d+/);
  expect(message).not.toContain("private-token");
  expect(diagnostic(`${source}version: 1\n`)).toContain("Duplicate YAML key");
});

test("missing targets and rule parameter errors include actionable field paths", () => {
  expect(diagnostic(source.replace("[org/repo]", "[]"))).toContain(
    "targets: Select at least one",
  );
  const text = source.replace(
    "test/rule: {}",
    "repository/required-reviews: {parameters: {minimum: 999}}",
  );
  const message = diagnostic(text, [
    {
      ...rule,
      id: "repository/required-reviews",
      validateParameters: (input) =>
        z.object({ minimum: z.number().max(6) }).parse(input),
    },
  ]);
  expect(message).toContain(
    'rules["repository/required-reviews"].parameters.minimum',
  );
  expect(message).toContain("maximum");
});

test("unreadable policy files have safe, actionable diagnostics", async () => {
  const file = path.join(
    os.tmpdir(),
    "kypa-missing-private-token",
    "policy.yaml",
  );
  const error = await loadPolicy(file, [rule]).catch(
    (failure: unknown) => failure,
  );
  const message = formatFailure(error);
  expect(message).toContain("CONFIG_FILE");
  expect(message).toContain("file path and read permissions");
  expect(message).not.toContain("private-token");
});

test("existing output errors identify the affected reporter without printing its path", async () => {
  const directory = await fsPromises.mkdtemp(
    path.join(os.tmpdir(), "kypa-config-"),
  );
  directories.push(directory);
  const file = path.join(directory, "policy.yaml");
  await fsPromises.writeFile(
    file,
    source.replace("report/report.json", "private-token.json"),
  );
  await fsPromises.writeFile(
    path.join(directory, "private-token.json"),
    "existing",
  );
  const error = await loadPolicy(file, [rule]).catch(
    (failure: unknown) => failure,
  );
  const message = formatFailure(error);
  expect(message).toContain(
    "reporters[0].options.path: Output destination already exists",
  );
  expect(message).not.toContain("private-token");
});
