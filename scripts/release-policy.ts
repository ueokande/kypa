import * as childProcess from 'node:child_process';

const versionPattern = /^(0|[1-9][0-9]*)[.](0|[1-9][0-9]*)[.](0|[1-9][0-9]*)$/;

export function versionForRelease(
  packageVersion: string,
  manifestVersion: string | undefined,
): string {
  if (
    !versionPattern.test(packageVersion) ||
    packageVersion !== manifestVersion
  )
    throw new Error('Package and release manifest versions must match.');
  return `v${packageVersion}`;
}

export function sourceRelease(
  directory: string,
  tag: string,
  expectedSha?: string,
): { source: string; version: string; sourceTag: string } {
  if (
    !/^source-v(0|[1-9][0-9]*)[.](0|[1-9][0-9]*)[.](0|[1-9][0-9]*)$/.test(tag)
  )
    throw new Error('An exact source-vX.Y.Z tag is required.');

  const git = (...args: string[]) =>
    childProcess
      .execFileSync('git', ['-C', directory, ...args], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
      })
      .trim();

  const source = git('rev-parse', '--verify', `refs/tags/${tag}^{commit}`);
  if (!/^[a-f0-9]{40}$/.test(source) || (expectedSha && expectedSha !== source))
    throw new Error('Source tag does not match the release-please output.');
  git('merge-base', '--is-ancestor', source, 'origin/master');
  return { source, version: tag.slice('source-'.length), sourceTag: tag };
}
