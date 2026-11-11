import * as childProcess from 'node:child_process';
import * as fsPromises from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, expect, test } from 'vitest';
import {
  notesForRelease,
  sourceRelease,
  versionForRelease,
} from './release-policy.js';

test('version and changelog selection are exact', () => {
  expect(versionForRelease('0.1.0', '0.1.0')).toBe('v0.1.0');
  expect(() => versionForRelease('0.2.0', '0.1.0')).toThrow();
  expect(
    notesForRelease(
      '# Changelog\n\n## [0.2.0](url)\nNew\n\n## [0.1.0](url)\nOld',
      'v0.2.0',
    ),
  ).toContain('New');
  expect(
    notesForRelease('## [0.2.0]\nNew\n## [0.1.0]\nOld', 'v0.2.0'),
  ).not.toContain('Old');
  expect(() => notesForRelease('# Empty', 'v0.1.0')).toThrow();
});
const directories: string[] = [];
afterEach(async () => {
  await Promise.all(
    directories
      .splice(0)
      .map((localPath) =>
        fsPromises.rm(localPath, { recursive: true, force: true }),
      ),
  );
});
test('source tags resolve to master commits, independently of distribution tags', async () => {
  const directory = await fsPromises.mkdtemp(
    path.join(os.tmpdir(), 'kypa-source-'),
  );
  directories.push(directory);

  const git = (...args: string[]) =>
    childProcess
      .execFileSync('git', ['-C', directory, ...args], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
      })
      .trim();

  git('init', '--initial-branch=master');
  git('config', 'commit.gpgsign', 'false');
  const identity = [
    '-c',
    'user.name=Fixture',
    '-c',
    'user.email=fixture@example.org',
  ];
  await fsPromises.writeFile(
    path.join(directory, 'source.ts'),
    'export const version = 1;',
  );
  git('add', '.');
  git(...identity, 'commit', '-m', 'source');
  const source = git('rev-parse', 'HEAD');
  git('update-ref', 'refs/remotes/origin/master', source);
  git('tag', 'source-v0.1.0');
  git('checkout', '--detach', source);
  await fsPromises.mkdir(path.join(directory, 'dist'), { recursive: true });
  await fsPromises.writeFile(path.join(directory, 'dist/index.js'), 'compiled');
  git('add', '.');
  git(...identity, 'commit', '-m', 'compiled');
  git('tag', 'v0.1.0');
  expect(sourceRelease(directory, 'source-v0.1.0', source)).toEqual({
    source,
    sourceTag: 'source-v0.1.0',
    version: 'v0.1.0',
  });
  expect(git('rev-parse', 'v0.1.0')).not.toBe(source);
  for (const invalid of [
    'v0.1.0',
    'master',
    'source-v0.1.0;bad',
    'source-v01.1.0',
    'source-v0.2.0',
  ])
    expect(() => sourceRelease(directory, invalid)).toThrow();
  expect(() =>
    sourceRelease(directory, 'source-v0.1.0', 'b'.repeat(40)),
  ).toThrow('does not match');
  git('tag', 'source-v0.2.0');
  expect(() => sourceRelease(directory, 'source-v0.2.0')).toThrow();
});
