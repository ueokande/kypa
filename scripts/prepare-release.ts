import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { prepareRelease } from './release.ts';
import { notesForRelease } from './release-policy.ts';

const version = process.env.RELEASE_VERSION;
if (!version || !process.env.RUNNER_TEMP)
  throw new Error('RELEASE_VERSION and RUNNER_TEMP are required.');
const notes = notesForRelease(await readFile('CHANGELOG.md', 'utf8'), version);
const result = await prepareRelease(process.cwd(), version, {
  reuseExisting: true,
});
await writeFile(
  join(process.env.RUNNER_TEMP, 'kypa-release-notes.md'),
  `${notes}\n\nSource commit: ${result.source}\nAction commit: ${result.commit}\n`,
);
console.log(
  `Prepared ${version}: source ${result.source}, release commit ${result.commit}.`,
);
