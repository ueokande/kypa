import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import type { Report } from '@kypa/sdk';
import { afterEach, expect, test } from 'vitest';
import { jsonReporter } from '../../json/src/index.js';
import { createHtmlReporter } from './index.js';

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
test.each(['/', '/monitor/'])(
  'reporters write portable HTML at %s without inline untrusted data',
  async (basePath) => {
    const directory = await mkdtemp(path.join(tmpdir(), 'kypa-reporter-'));
    directories.push(directory);
    const assets = await mkdtemp(path.join(tmpdir(), 'kypa-assets-'));
    directories.push(assets);
    await writeFile(
      path.join(assets, 'index.html'),
      '<html><head></head><body><script src="./app.js"></script></body></html>',
    );
    await writeFile(path.join(assets, 'app.js'), '/* fixture */');
    await jsonReporter.write(
      report,
      { path: 'report/report.json' },
      { policyDirectory: directory },
    );
    await createHtmlReporter(assets).write(
      report,
      { directory: 'site', basePath },
      { policyDirectory: directory },
    );
    expect(
      JSON.parse(
        await readFile(path.join(directory, 'report/report.json'), 'utf8'),
      ),
    ).toEqual(report);
    expect(
      JSON.parse(
        await readFile(path.join(directory, 'site/data.json'), 'utf8'),
      ),
    ).toEqual(report);
    const html = await readFile(
      path.join(directory, 'site/index.html'),
      'utf8',
    );
    expect(html).toContain(`<base href="${basePath}">`);
    expect((await readdir(path.join(directory, 'site'))).sort()).toEqual([
      'app.js',
      'data.json',
      'index.html',
    ]);
    expect(html).not.toContain('alert(1)');
    await expect(
      jsonReporter.write(
        report,
        { path: 'report/report.json' },
        { policyDirectory: directory },
      ),
    ).rejects.toThrow();
    await expect(
      createHtmlReporter(assets).write(
        report,
        { directory: 'site', basePath: '/' },
        { policyDirectory: directory },
      ),
    ).rejects.toThrow();
  },
);
