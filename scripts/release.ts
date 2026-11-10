import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { lstat, readdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
export async function prepareRelease(
  directory: string,
  version: string,
): Promise<{ source: string; commit: string }> {
  if (!/^v(0|[1-9][0-9]*)[.](0|[1-9][0-9]*)[.](0|[1-9][0-9]*)$/.test(version))
    throw new Error('An exact stable version tag is required.');
  const git = (...args: string[]) =>
    execFileSync('git', ['-C', directory, ...args], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim();
  if (resolve(git('rev-parse', '--show-toplevel')) !== resolve(directory))
    throw new Error('Run from the checkout root.');
  if (git('status', '--porcelain', '--untracked-files=all'))
    throw new Error('Release source must be clean.');
  const manifest = JSON.parse(
    await readFile(join(directory, 'package.json'), 'utf8'),
  ) as { version: string };
  if (version !== `v${manifest.version}`)
    throw new Error('Tag must match the root package version.');
  const existing = spawnSync('git', [
    '-C',
    directory,
    'show-ref',
    '--verify',
    '--quiet',
    `refs/tags/${version}`,
  ]);
  if (existing.status !== 1)
    throw new Error('Tag already exists or could not be checked.');
  const head = spawnSync('git', [
    '-C',
    directory,
    'symbolic-ref',
    '--quiet',
    'HEAD',
  ]);
  if (head.status !== 1)
    throw new Error('Release preparation requires a detached checkout.');
  const source = git('rev-parse', '--verify', 'HEAD^{commit}');
  const hashes: Record<string, string> = {};
  const walk = async (path: string): Promise<void> => {
    const absolute = join(directory, path);
    const stat = await lstat(absolute);
    if (stat.isSymbolicLink())
      throw new Error('Release artifacts must not contain symlinks.');
    if (stat.isDirectory()) {
      for (const name of (await readdir(absolute)).sort())
        await walk(`${path}/${name}`);
    } else if (stat.isFile())
      hashes[path] = createHash('sha256')
        .update(await readFile(absolute))
        .digest('hex');
    else throw new Error('Unsupported release artifact.');
  };
  await walk('dist/action');
  await walk('dist/dashboard');
  if (!hashes['dist/action/index.js'] || !hashes['dist/dashboard/index.html'])
    throw new Error('Action or dashboard build is missing.');
  await writeFile(
    join(directory, 'dist/provenance.json'),
    `${JSON.stringify({ version, source, sha256: hashes }, null, 2)}
`,
  );
  git(
    'add',
    '--force',
    '--',
    'dist/action',
    'dist/dashboard',
    'dist/provenance.json',
  );
  const identity = [
    '-c',
    'user.name=github-actions[bot]',
    '-c',
    'user.email=41898282+github-actions[bot]@users.noreply.github.com',
  ];
  git(
    ...identity,
    'commit',
    '-m',
    `release: prepare ${version} from ${source}`,
  );
  const commit = git('rev-parse', '--verify', 'HEAD^{commit}');
  git(
    ...identity,
    'tag',
    '--annotate',
    version,
    '-m',
    `${version}\nSource: ${source}\nRelease commit: ${commit}`,
  );
  return { source, commit };
}
