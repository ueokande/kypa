import assert from "node:assert/strict";
import * as childProcess from "node:child_process";
import * as fsPromises from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import * as url from "node:url";

const root = url.fileURLToPath(new URL("../../", import.meta.url));
const entry = path.join(root, "dist/cli/index.js");
const help = childProcess.spawnSync(process.execPath, [entry, "--help"], {
  encoding: "utf8",
  env: {},
  timeout: 30_000,
});
assert.equal(help.status, 0, help.stderr);
assert.match(help.stdout, /Usage: kypa/);

for (const scenario of ["report", "violation", "fatal", "invalid"]) {
  const directory = await fsPromises.mkdtemp(
    path.join(os.tmpdir(), "kypa-cli-smoke-"),
  );
  try {
    const config = path.join(directory, "policy.yaml");
    await fsPromises.writeFile(
      config,
      `version: 1
targets:
  repositories: [fixture/target]
rules:
  actions/full-sha: {}
  repository/required-reviews:
    parameters: {minimum: 2}
reporters:
  - name: json
    options: {path: report/report.json}
  - name: html
    options: {directory: site, basePath: ${scenario === "invalid" ? "./report" : "/"}}
`,
    );
    const child = childProcess.spawnSync(
      process.execPath,
      [
        "--import",
        url.fileURLToPath(new URL("./fixtures/github.ts", import.meta.url)),
        entry,
        "--config",
        config,
        "--fail-on",
        scenario === "violation" ? "violation" : "never",
      ],
      {
        cwd: root,
        encoding: "utf8",
        timeout: 30_000,
        env: { GH_TOKEN: scenario === "fatal" ? "" : "fixture-token" },
      },
    );
    assert.equal(
      child.status,
      scenario === "report" ? 0 : scenario === "violation" ? 1 : 2,
      child.stderr + child.stdout,
    );
    assert.equal(
      (child.stderr + child.stdout).includes("fixture-token"),
      false,
    );
    if (scenario === "fatal" || scenario === "invalid") {
      if (scenario === "invalid") {
        assert.match(child.stderr, /reporters\[1\]\.options\.basePath/);
        assert.match(child.stderr, /starting and ending with/);
        assert.equal(child.stderr.includes("./report"), false);
      }
      await assert.rejects(
        fsPromises.access(path.join(directory, "report/report.json")),
      );
      continue;
    }
    const report = JSON.parse(
      await fsPromises.readFile(
        path.join(directory, "report/report.json"),
        "utf8",
      ),
    );
    assert.equal(report.run.status, "complete");
    assert.equal(report.findings.length, 2);
    assert.match(child.stdout, /violations: 2/);
    assert.match(
      await fsPromises.readFile(
        path.join(directory, "site/index.html"),
        "utf8",
      ),
      /<base href="\/">/,
    );
    assert.deepEqual(
      JSON.parse(
        await fsPromises.readFile(
          path.join(directory, "site/data.json"),
          "utf8",
        ),
      ),
      report,
    );
    assert.equal(JSON.stringify(report).includes("fixture-token"), false);
  } finally {
    await fsPromises.rm(directory, { recursive: true, force: true });
  }
}
console.log(
  "Bundled CLI smoke checks passed: help, JSON/HTML reports, failure policy, authentication, and configuration diagnostics.",
);
