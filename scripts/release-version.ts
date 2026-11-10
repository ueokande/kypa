import { appendFile, readFile } from 'node:fs/promises';
import { versionForRelease } from './release-policy.ts';

const manifest = JSON.parse(
  await readFile('.release-please-manifest.json', 'utf8'),
);
const pkg = JSON.parse(await readFile('package.json', 'utf8'));
const version = versionForRelease(pkg.version, manifest['.']);
if (!process.env.GITHUB_OUTPUT) throw new Error('GITHUB_OUTPUT is required.');
await appendFile(process.env.GITHUB_OUTPUT, `version=${version}\n`);
