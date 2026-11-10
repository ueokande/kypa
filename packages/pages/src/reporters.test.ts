import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Report } from '@kypa/sdk';
import { afterEach, expect, test } from 'vitest';
import { jsonReporter } from '../../json/src/index.js';
import { createPagesReporter } from './index.js';

const directories: string[] = [];
afterEach(async () => {
  await Promise.all(
    directories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});
const report = {
  schemaVersion: 1,
  run: { status: 'partial' },
  findings: [],
  errors: [{ message: '<script>alert(1)</script>' }],
} as unknown as Report;
test('reporters write complete JSON and static site with basePath, without inline untrusted data', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'kypa-reporter-'));
  directories.push(directory);
  const assets = await mkdtemp(join(tmpdir(), 'kypa-assets-'));
  directories.push(assets);
  await writeFile(
    join(assets, 'index.html'),
    '<html><head></head><body><script src="./app.js"></script></body></html>',
  );
  await writeFile(join(assets, 'app.js'), '/* fixture */');
  await jsonReporter.write(
    report,
    { path: 'report/report.json' },
    { policyDirectory: directory },
  );
  await createPagesReporter(assets).write(
    report,
    { directory: 'site', basePath: '/monitor/' },
    { policyDirectory: directory },
  );
  expect(
    JSON.parse(await readFile(join(directory, 'report/report.json'), 'utf8')),
  ).toEqual(report);
  expect(
    JSON.parse(await readFile(join(directory, 'site/data.json'), 'utf8')),
  ).toEqual(report);
  const html = await readFile(join(directory, 'site/index.html'), 'utf8');
  expect(html).toContain('<base href="/monitor/">');
  expect(html).not.toContain('alert(1)');
  await expect(
    jsonReporter.write(
      report,
      { path: 'report/report.json' },
      { policyDirectory: directory },
    ),
  ).rejects.toThrow();
  await expect(
    createPagesReporter(assets).write(
      report,
      { directory: 'site', basePath: '/' },
      { policyDirectory: directory },
    ),
  ).rejects.toThrow();
});
