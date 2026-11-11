import { appendFile } from 'node:fs/promises';
import { sourceRelease } from './release-policy.ts';

const tag = process.env.SOURCE_TAG;
const output = process.env.GITHUB_OUTPUT;
if (!tag || !output)
  throw new Error('SOURCE_TAG and GITHUB_OUTPUT are required.');
const metadata = sourceRelease(
  process.cwd(),
  tag,
  process.env.SOURCE_SHA || undefined,
);
await appendFile(
  output,
  `source=${metadata.source}\nsource_tag=${metadata.sourceTag}\nversion=${metadata.version}\n`,
);
