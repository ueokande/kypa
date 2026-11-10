import { readFile } from 'node:fs/promises';
import { Manifest } from 'release-please';
import { expect, test } from 'vitest';
import { notesForRelease } from './release-policy.js';

test('official release-please builds a single first-release PR with the expected branch and version', async () => {
  const config = JSON.parse(
    await readFile('release-please-config.json', 'utf8'),
  );
  const versions = JSON.parse(
    await readFile('.release-please-manifest.json', 'utf8'),
  );
  const github = {
    repository: { owner: 'ueokande', repo: 'kypa' },
    getFileJson: async (path: string) =>
      path === 'release-please-config.json' ? config : versions,
    getFileContentsOnBranch: async () => ({
      parsedContent: '{"name":"kypa","version":"0.1.0"}',
      content: '',
      sha: 'a'.repeat(40),
    }),
    async *releaseIterator() {
      yield* [];
    },
    async *tagIterator() {
      yield* [];
    },
    async *mergeCommitIterator() {
      yield {
        sha: 'b'.repeat(40),
        message: 'feat: implement initial Action',
        files: ['packages/action/src/index.ts'],
      };
      yield {
        sha: config['bootstrap-sha'],
        message: 'docs: initialize a project',
        files: ['README.md'],
      };
    },
  } as unknown as Parameters<typeof Manifest.fromManifest>[0];
  const manifest = await Manifest.fromManifest(github, 'master');
  expect(manifest.repositoryConfig['.']?.skipGithubRelease).toBe(true);
  const candidates = await manifest.buildPullRequests();
  expect(candidates).toHaveLength(1);
  const changelog = candidates[0]?.updates
    .find((update) => update.path === 'CHANGELOG.md')
    ?.updater.updateContent('# Changelog\n');
  expect(notesForRelease(changelog ?? '', 'v0.1.0')).toContain(
    'implement initial Action',
  );
  expect(candidates[0]?.headRefName).toBe('release-please--branches--master');
  expect(candidates[0]?.body.releaseData?.[0]?.version?.toString()).toBe(
    '0.1.0',
  );
});

test('later Release PRs exclude commits before the recorded source cutoff', async () => {
  const config = JSON.parse(
    await readFile('release-please-config.json', 'utf8'),
  );
  const source = 'a'.repeat(40);
  const github = {
    repository: { owner: 'ueokande', repo: 'kypa' },
    getFileJson: async (path: string) =>
      path === 'release-please-config.json' ? config : { '.': '0.1.0' },
    getFileContentsOnBranch: async () => ({
      parsedContent: '{"name":"kypa","version":"0.1.0"}',
      content: '',
      sha: source,
    }),
    async *releaseIterator() {
      yield {
        tagName: 'v0.1.0',
        sha: 'c'.repeat(40),
        name: 'v0.1.0',
        notes: '',
      };
    },
    async *tagIterator() {
      yield* [];
    },
    async *mergeCommitIterator() {
      yield {
        sha: 'b'.repeat(40),
        message: 'feat: add fresh behavior',
        files: ['packages/action/src/index.ts'],
      };
      yield {
        sha: source,
        message: 'chore(master): release 0.1.0',
        files: ['package.json'],
      };
      yield {
        sha: 'd'.repeat(40),
        message: 'feat: old behavior already released',
        files: ['packages/action/src/index.ts'],
      };
    },
  } as unknown as Parameters<typeof Manifest.fromManifest>[0];
  const manifest = await Manifest.fromManifest(
    github,
    'master',
    undefined,
    undefined,
    { lastReleaseSha: source },
  );
  const candidates = await manifest.buildPullRequests();
  expect(candidates).toHaveLength(1);
  const changelog = candidates[0]?.updates
    .find((update) => update.path === 'CHANGELOG.md')
    ?.updater.updateContent('# Changelog\n');
  expect(changelog).toContain('fresh behavior');
  expect(changelog).not.toContain('old behavior already released');
  expect(candidates[0]?.body.releaseData?.[0]?.version?.toString()).toBe(
    '0.2.0',
  );
});
