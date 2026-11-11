import * as fsPromises from 'node:fs/promises';
import { versionForRelease } from './release-policy.ts';

const manifest = JSON.parse(
  await fsPromises.readFile('.release-please-manifest.json', 'utf8'),
);
const pkg = JSON.parse(await fsPromises.readFile('package.json', 'utf8'));
const version = versionForRelease(pkg.version, manifest['.']);
if (process.env.SOURCE_TAG !== `source-${version}`)
  throw new Error('Source tag and checked-out package version must match.');
if (!process.env.GITHUB_OUTPUT) throw new Error('GITHUB_OUTPUT is required.');
await fsPromises.appendFile(process.env.GITHUB_OUTPUT, `version=${version}\n`);
