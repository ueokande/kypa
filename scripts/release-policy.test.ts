import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, test } from 'vitest';
import {
  notesForRelease,
  releaseBaseline,
  releasePullRequest,
  versionForRelease,
} from './release-policy.js';

const repository = 'ueokande/kypa';
const pr = {
  merged: true,
  number: 10,
  merge_commit_sha: 'a'.repeat(40),
  base: { ref: 'master', repo: { full_name: repository } },
  head: {
    ref: 'release-please--branches--master',
    repo: { full_name: repository },
  },
  labels: [{ name: 'autorelease: pending' }],
};
test('only merged same-repository Release PRs can publish', () => {
  expect(releasePullRequest(pr, repository)).toEqual({
    source: 'a'.repeat(40),
    number: 10,
  });
  for (const change of [
    { merged: false },
    { labels: [] },
    { merge_commit_sha: 'master' },
    { head: { ...pr.head, repo: { full_name: 'other/fork' } } },
    { head: { ...pr.head, ref: 'feature' } },
  ])
    expect(() =>
      releasePullRequest({ ...pr, ...change }, repository),
    ).toThrow();
});
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
      .map((path) => rm(path, { recursive: true, force: true })),
  );
});
test('release-please uses the recorded source baseline rather than the off-branch compiled tag', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'kypa-baseline-'));
  directories.push(directory);
  const git = (...args: string[]) =>
    execFileSync('git', ['-C', directory, ...args], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim();
  git('init', '--initial-branch=master');
  git('config', 'commit.gpgsign', 'false');
  const identity = [
    '-c',
    'user.name=Fixture',
    '-c',
    'user.email=fixture@example.org',
  ];
  await writeFile(
    join(directory, '.release-please-manifest.json'),
    '{".":"0.0.0"}',
  );
  git('add', '.');
  git(...identity, 'commit', '-m', 'source');
  expect(await releaseBaseline(directory)).toBeUndefined();
  await writeFile(
    join(directory, '.release-please-manifest.json'),
    '{".":"0.1.0"}',
  );
  git('add', '.');
  git(...identity, 'commit', '-m', 'release PR');
  const source = git('rev-parse', 'HEAD');
  expect(await releaseBaseline(directory)).toBeNull();
  git('checkout', '--detach', source);
  await mkdir(join(directory, 'dist'), { recursive: true });
  await writeFile(
    join(directory, 'dist/provenance.json'),
    JSON.stringify({ version: 'v0.1.0', source }),
  );
  git('add', '.');
  git(...identity, 'commit', '-m', 'compiled release');
  git('tag', 'v0.1.0');
  git('checkout', 'master');
  expect(await releaseBaseline(directory)).toBe(source);
  expect(git('rev-parse', 'v0.1.0')).not.toBe(source);
});
