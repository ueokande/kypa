import * as childProcess from 'node:child_process';
import * as fsPromises from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, expect, test } from 'vitest';
import { prepareRelease } from './release.js';

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

async function fixture() {
  const directory = await fsPromises.mkdtemp(
    path.join(os.tmpdir(), 'kypa-release-'),
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
  await fsPromises.writeFile(path.join(directory, '.gitignore'), 'dist/\n');
  await fsPromises.writeFile(
    path.join(directory, 'package.json'),
    '{"version":"0.1.0"}',
  );
  await fsPromises.writeFile(
    path.join(directory, 'source.ts'),
    'export const version = 1;\n',
  );
  git('add', '.');
  git(
    '-c',
    'user.name=Fixture',
    '-c',
    'user.email=fixture@example.org',
    'commit',
    '-m',
    'Source',
  );
  const source = git('rev-parse', 'HEAD');
  git('checkout', '--detach', source);
  await fsPromises.mkdir(path.join(directory, 'dist/action'), {
    recursive: true,
  });
  await fsPromises.mkdir(path.join(directory, 'dist/dashboard'), {
    recursive: true,
  });
  await fsPromises.writeFile(
    path.join(directory, 'dist/action/index.js'),
    '/* fixture action */',
  );
  await fsPromises.writeFile(
    path.join(directory, 'dist/dashboard/index.html'),
    '<html></html>',
  );
  return { directory, git, source };
}

test('release tag points to a generated commit while master remains source-only', async () => {
  const { directory, git, source } = await fixture();
  const result = await prepareRelease(directory, 'v0.1.0');
  expect(git('rev-parse', 'master')).toBe(source);
  expect(result.source).toBe(source);
  expect(result.commit).not.toBe(source);
  expect(git('rev-parse', 'v0.1.0^{commit}')).toBe(result.commit);
  expect(
    git('diff-tree', '--no-commit-id', '--name-only', '-r', result.commit)
      .split('\n')
      .every((localPath) => localPath.startsWith('dist/')),
  ).toBe(true);
  const provenance = JSON.parse(
    await fsPromises.readFile(
      path.join(directory, 'dist/provenance.json'),
      'utf8',
    ),
  );
  expect(provenance.source).toBe(source);
  expect(provenance.sha256['dist/action/index.js']).toMatch(/^[a-f0-9]{64}$/);
  // The workflow uses a detached checkout; this fixture verifies the original source tree directly.
  expect(git('ls-tree', '--name-only', source)).not.toContain('dist');
  await expect(prepareRelease(directory, 'v0.1.0')).rejects.toThrow(
    'Tag already exists',
  );
});
test('invalid/mismatched versions and dirty source block preparation', async () => {
  const { directory } = await fixture();
  await expect(prepareRelease(directory, 'v1.0.0; bad')).rejects.toThrow(
    'exact stable',
  );
  await expect(prepareRelease(directory, 'v1.0.0')).rejects.toThrow('match');
  await fsPromises.writeFile(path.join(directory, 'source.ts'), 'changed');
  await expect(prepareRelease(directory, 'v0.1.0')).rejects.toThrow('clean');
});

test('release preparation never changes a checked-out source branch', async () => {
  const { directory, git, source } = await fixture();
  git('checkout', 'master');
  await expect(prepareRelease(directory, 'v0.1.0')).rejects.toThrow('detached');
  expect(git('rev-parse', 'HEAD')).toBe(source);
});

test('publication retries reuse an identical tag without moving it and reject changed builds', async () => {
  const { directory, git, source } = await fixture();
  const first = await prepareRelease(directory, 'v0.1.0');
  git('checkout', '--detach', source);
  await fsPromises.mkdir(path.join(directory, 'dist/action'), {
    recursive: true,
  });
  await fsPromises.mkdir(path.join(directory, 'dist/dashboard'), {
    recursive: true,
  });
  await fsPromises.writeFile(
    path.join(directory, 'dist/action/index.js'),
    '/* fixture action */',
  );
  await fsPromises.writeFile(
    path.join(directory, 'dist/dashboard/index.html'),
    '<html></html>',
  );
  expect(
    await prepareRelease(directory, 'v0.1.0', { reuseExisting: true }),
  ).toEqual(first);
  expect(git('rev-parse', 'HEAD')).toBe(source);
  await fsPromises.writeFile(
    path.join(directory, 'dist/action/index.js'),
    'changed build',
  );
  await expect(
    prepareRelease(directory, 'v0.1.0', { reuseExisting: true }),
  ).rejects.toThrow('differ');
  expect(git('rev-parse', 'v0.1.0^{commit}')).toBe(first.commit);
});
