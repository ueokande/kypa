import * as fsPromises from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import type { Rule } from '@kypa/sdk';
import { afterEach, expect, test } from 'vitest';
import { loadPolicy, matchesPattern, parsePolicy } from './config.js';

const rule: Rule = {
  id: 'test/rule',
  version: '1',
  resourceTypes: ['github/repository'],
  requiredEvidence: [],
  defaultSeverity: 'high',
  validateParameters: (input) => input,
  evaluate: () => ({ applicable: true, findings: [] }),
};
const source = `version: 1
targets:
  repositories: [org/repo]
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
test('defaults collection controls and rule settings', () => {
  const policy = parsePolicy(source, [rule]);
  expect(policy.scan).toEqual({
    concurrency: 4,
    retries: 3,
    requestTimeoutSeconds: 30,
  });
  expect(policy.rules[0]?.severity).toBe('high');
  expect(policy.targets.includeArchived).toBe(false);
});
test.each([
  source.replace('version: 1', 'version: 1\nversion: 1'),
  `${source}exceptions: []\n`,
  `${source}plugins: []\n`,
  source.replace('test/rule: {}', 'test/unknown: {}'),
  source.replace('test/rule: {}', 'test/rule: {enabled: false}'),
  source.replace('[org/repo]', '[]'),
  source.replace(
    'path: report/report.json',
    'path: report/report.json, extra: true',
  ),
])('rejects unknown and duplicate keys and invalid policy', (text) => {
  expect(() => parsePolicy(text, [rule])).toThrow();
});
test('patterns are case-insensitive, escape dots, and cannot cross owner boundaries', () => {
  expect(matchesPattern('Org/service.api', 'org/service.*')).toBe(true);
  expect(matchesPattern('org/serviceXapi', 'org/service.api')).toBe(false);
  expect(matchesPattern('org/nested/name', 'org/*')).toBe(false);
});
test('rejects overlapping, existing, escaping, and symlink output destinations', async () => {
  const directory = await fsPromises.mkdtemp(
    path.join(os.tmpdir(), 'kypa-config-'),
  );
  directories.push(directory);
  const file = path.join(directory, 'policy.yaml');

  const check = async (text: string) => {
    await fsPromises.writeFile(file, text);
    return loadPolicy(file, [rule]);
  };

  await expect(check(source)).resolves.toMatchObject({ directory });
  await expect(
    check(source.replace('report/report.json', '../outside.json')),
  ).rejects.toThrow();
  await expect(
    check(source.replace('report/report.json', 'policy.yaml')),
  ).rejects.toThrow();
  await expect(
    check(
      `${source}  - name: html\n    options: {directory: report, basePath: /}\n`,
    ),
  ).rejects.toThrow();
  await fsPromises.mkdir(path.join(directory, 'report'));
  await fsPromises.writeFile(
    path.join(directory, 'report/report.json'),
    'existing',
  );
  await expect(check(source)).rejects.toThrow();
  await fsPromises.symlink(os.tmpdir(), path.join(directory, 'escape'));
  await expect(
    check(source.replace('report/report.json', 'escape/new.json')),
  ).rejects.toThrow();
});
