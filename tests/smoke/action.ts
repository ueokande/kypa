import assert from "node:assert/strict";
import * as childProcess from "node:child_process";
import * as fsPromises from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import * as url from "node:url";

const root = url.fileURLToPath(new URL("../../", import.meta.url));
for (const scenario of ["report", "violation", "fatal"]) {
  const directory = await fsPromises.mkdtemp(
    path.join(os.tmpdir(), "kypa-action-smoke-"),
  );
  try {
    await fsPromises.writeFile(
      path.join(directory, "kypa.yaml"),
      `version: 1
targets:
  repos: [fixture/target]
rules:
  actions/full-sha: {}
  repository/required-reviews:
    parameters: {minimum: 2}
reporters:
  - name: json
    options: {path: report/report.json}
  - name: html
    options: {directory: site, basePath: /monitor/}
`,
    );
    const output = path.join(directory, "outputs");
    const summary = path.join(directory, "summary");
    await fsPromises.writeFile(output, "");
    await fsPromises.writeFile(summary, "");
    const child = childProcess.spawnSync(
      process.execPath,
      [
        "--import",
        url.fileURLToPath(new URL("./fixtures/github.ts", import.meta.url)),
        path.join(root, "dist/action/index.js"),
      ],
      {
        cwd: directory,
        encoding: "utf8",
        timeout: 30_000,
        env: {
          PATH: process.env.PATH ?? "",
          INPUT_TOKEN: scenario === "fatal" ? "" : "fixture-token",
          INPUT_CONFIG: "kypa.yaml",
          "INPUT_FAIL-ON": scenario === "violation" ? "violation" : "never",
          GITHUB_OUTPUT: output,
          GITHUB_STEP_SUMMARY: summary,
        },
      },
    );
    assert.equal(
      child.status,
      scenario === "report" ? 0 : 1,
      child.stderr + child.stdout,
    );
    const outputs = await fsPromises.readFile(output, "utf8");
    if (scenario === "fatal") {
      assert.equal(outputs, "");
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
    assert.equal(report.resources[0].metadata.scannedCommit, "a".repeat(40));
    assert.match(outputs, /violation-count/);
    assert.match(outputs, /complete/);
    assert.match(await fsPromises.readFile(summary, "utf8"), /Kypa scan/);
    const html = await fsPromises.readFile(
      path.join(directory, "site/index.html"),
      "utf8",
    );
    assert.match(html, /<base href="\/monitor\/">/);
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
  "Bundled Action smoke checks passed: report generation, failure policy, fatal inputs, JSON and HTML assets.",
);
