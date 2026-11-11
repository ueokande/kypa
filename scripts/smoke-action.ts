import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
for (const scenario of ['report', 'violation', 'fatal']) {
  const directory = await mkdtemp(join(tmpdir(), 'kypa-action-smoke-'));
  try {
    await writeFile(
      join(directory, 'kypa.yaml'),
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
    options: {directory: site, basePath: /monitor/}
`,
    );
    const output = join(directory, 'outputs');
    const summary = join(directory, 'summary');
    await writeFile(output, '');
    await writeFile(summary, '');
    const child = spawnSync(
      process.execPath,
      [
        '--import',
        join(root, 'scripts/fixtures/github.ts'),
        join(root, 'dist/action/index.js'),
      ],
      {
        cwd: directory,
        encoding: 'utf8',
        timeout: 30_000,
        env: {
          PATH: process.env.PATH ?? '',
          INPUT_TOKEN: scenario === 'fatal' ? '' : 'fixture-token',
          INPUT_CONFIG: 'kypa.yaml',
          'INPUT_FAIL-ON': scenario === 'violation' ? 'violation' : 'never',
          GITHUB_OUTPUT: output,
          GITHUB_STEP_SUMMARY: summary,
        },
      },
    );
    assert.equal(
      child.status,
      scenario === 'report' ? 0 : 1,
      child.stderr + child.stdout,
    );
    const outputs = await readFile(output, 'utf8');
    if (scenario === 'fatal') {
      assert.equal(outputs, '');
      continue;
    }
    const report = JSON.parse(
      await readFile(join(directory, 'report/report.json'), 'utf8'),
    );
    assert.equal(report.run.status, 'complete');
    assert.equal(report.findings.length, 2);
    assert.equal(report.resources[0].metadata.scannedCommit, 'a'.repeat(40));
    assert.match(outputs, /violation-count/);
    assert.match(outputs, /complete/);
    assert.match(await readFile(summary, 'utf8'), /Kypa scan/);
    const html = await readFile(join(directory, 'site/index.html'), 'utf8');
    assert.match(html, /<base href="\/monitor\/">/);
    assert.deepEqual(
      JSON.parse(await readFile(join(directory, 'site/data.json'), 'utf8')),
      report,
    );
    assert.equal(JSON.stringify(report).includes('fixture-token'), false);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
console.log(
  'Bundled Action smoke checks passed: report generation, failure policy, fatal inputs, JSON and HTML assets.',
);
