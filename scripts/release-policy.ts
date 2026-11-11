import { execFileSync, spawnSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import * as path from 'node:path';

const shaPattern = /^[a-f0-9]{40}$/;
const versionPattern = /^[0-9]+[.][0-9]+[.][0-9]+$/;
export async function releaseBaseline(
  directory: string,
): Promise<string | undefined | null> {
  const manifest = JSON.parse(
    await readFile(
      path.join(directory, '.release-please-manifest.json'),
      'utf8',
    ),
  ) as Record<string, string>;
  const version = manifest['.'];
  if (!version || !versionPattern.test(version))
    throw new Error('Invalid release manifest.');
  if (version === '0.0.0') return undefined;
  const tag = `v${version}`;
  const existing = spawnSync('git', [
    '-C',
    directory,
    'show-ref',
    '--verify',
    '--quiet',
    `refs/tags/${tag}`,
  ]);
  if (existing.status === 1) return null; // A merged Release PR is awaiting publication.
  if (existing.status !== 0) throw new Error('Cannot inspect published tag.');
  const provenance = JSON.parse(
    execFileSync(
      'git',
      ['-C', directory, 'show', `${tag}:dist/provenance.json`],
      { encoding: 'utf8' },
    ),
  ) as { source: string; version: string };
  if (provenance.version !== tag || !shaPattern.test(provenance.source))
    throw new Error('Invalid release provenance.');
  const ancestor = spawnSync('git', [
    '-C',
    directory,
    'merge-base',
    '--is-ancestor',
    provenance.source,
    'HEAD',
  ]);
  if (ancestor.status !== 0)
    throw new Error('Published source is not in the development history.');
  return provenance.source;
}
export function releasePullRequest(
  input: unknown,
  repository: string,
): { source: string; number: number } {
  const pr = input as {
    merged?: boolean;
    number?: number;
    merge_commit_sha?: string;
    base?: { ref?: string; repo?: { full_name?: string } };
    head?: { ref?: string; repo?: { full_name?: string } };
    labels?: { name?: string }[];
  };
  if (
    pr?.merged !== true ||
    pr.base?.ref !== 'master' ||
    pr.base.repo?.full_name !== repository ||
    pr.head?.repo?.full_name !== repository ||
    pr.head?.ref !== 'release-please--branches--master' ||
    !pr.labels?.some(
      (label) =>
        label.name === 'autorelease: pending' ||
        label.name === 'autorelease: tagged',
    ) ||
    !Number.isSafeInteger(pr.number) ||
    (pr.number ?? 0) <= 0 ||
    !shaPattern.test(pr.merge_commit_sha ?? '')
  )
    throw new Error(
      'Only a merged same-repository Release PR can be published.',
    );
  return { source: pr.merge_commit_sha as string, number: pr.number as number };
}
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
