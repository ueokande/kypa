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

export function notesForRelease(changelog: string, version: string): string {
  const heading = `## [${version.slice(1)}]`;
  const lines = changelog.split('\n');
  const start = lines.findIndex(
    (line) =>
      line.startsWith(heading) ||
      line.startsWith(`## ${version.slice(1)} (`) ||
      line === `## ${version.slice(1)}`,
  );
  if (start < 0) throw new Error('Release changelog section is missing.');
  const next = lines.findIndex(
    (line, index) => index > start && line.startsWith('## '),
  );
  return lines
    .slice(start, next < 0 ? undefined : next)
    .join('\n')
    .trim();
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
