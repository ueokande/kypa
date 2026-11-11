import * as childProcess from 'node:child_process';
import * as crypto from 'node:crypto';
import * as fsPromises from 'node:fs/promises';
import * as path from 'node:path';

export async function prepareRelease(
  directory: string,
  version: string,
  options: { reuseExisting?: boolean } = {},
): Promise<{ source: string; commit: string }> {
  if (!/^v(0|[1-9][0-9]*)[.](0|[1-9][0-9]*)[.](0|[1-9][0-9]*)$/.test(version))
    throw new Error('An exact stable version tag is required.');

  const git = (...args: string[]) =>
    childProcess
      .execFileSync('git', ['-C', directory, ...args], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
      })
      .trim();

  if (
    path.resolve(git('rev-parse', '--show-toplevel')) !==
    path.resolve(directory)
  )
    throw new Error('Run from the checkout root.');
  if (git('status', '--porcelain', '--untracked-files=all'))
    throw new Error('Release source must be clean.');
  const manifest = JSON.parse(
    await fsPromises.readFile(path.join(directory, 'package.json'), 'utf8'),
  ) as { version: string };
  if (version !== `v${manifest.version}`)
    throw new Error('Tag must match the root package version.');
  const existing = childProcess.spawnSync('git', [
    '-C',
    directory,
    'show-ref',
    '--verify',
    '--quiet',
    `refs/tags/${version}`,
  ]);
  if (
    existing.status !== 1 &&
    !(existing.status === 0 && options.reuseExisting)
  )
    throw new Error('Tag already exists or could not be checked.');
  const head = childProcess.spawnSync('git', [
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

  const walk = async (localPath: string): Promise<void> => {
    const absolute = path.join(directory, localPath);
    const stat = await fsPromises.lstat(absolute);
    if (stat.isSymbolicLink())
      throw new Error('Release artifacts must not contain symlinks.');
    if (stat.isDirectory()) {
      for (const name of (await fsPromises.readdir(absolute)).sort())
        await walk(`${localPath}/${name}`);
    } else if (stat.isFile())
      hashes[localPath] = crypto
        .createHash('sha256')
        .update(await fsPromises.readFile(absolute))
        .digest('hex');
    else throw new Error('Unsupported release artifact.');
  };

  await walk('dist/action');
  await walk('dist/dashboard');
  if (existing.status === 0) {
    const previous = JSON.parse(
      git('show', `${version}:dist/provenance.json`),
    ) as { version: string; source: string; sha256: Record<string, string> };
    const previousPaths = git(
      'ls-tree',
      '-r',
      '--name-only',
      version,
      '--',
      'dist/action',
      'dist/dashboard',
    )
      .split('\n')
      .sort();
    if (
      previous.version !== version ||
      previous.source !== source ||
      JSON.stringify(previousPaths) !==
        JSON.stringify(Object.keys(hashes).sort())
    )
      throw new Error('Existing tag has different source or artifacts.');
    for (const [path, hash] of Object.entries(hashes)) {
      const content = childProcess.execFileSync('git', [
        '-C',
        directory,
        'show',
        `${version}:${path}`,
      ]);
      if (
        previous.sha256[path] !== hash ||
        crypto.createHash('sha256').update(content).digest('hex') !== hash
      )
        throw new Error(
          'Existing tag artifacts differ from the verified build.',
        );
    }
    if (git('rev-parse', `${version}^`) !== source)
      throw new Error('Existing tag has an unexpected parent.');
    return { source, commit: git('rev-parse', `${version}^{commit}`) };
  }
  await fsPromises.writeFile(
    path.join(directory, 'dist/provenance.json'),
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
