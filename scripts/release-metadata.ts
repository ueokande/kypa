import { execFileSync } from 'node:child_process';
import { appendFile, readFile } from 'node:fs/promises';
import { releasePullRequest } from './release-policy.ts';

const repository = process.env.GITHUB_REPOSITORY;
const output = process.env.GITHUB_OUTPUT;
const eventPath = process.env.GITHUB_EVENT_PATH;
if (!repository || !output || !eventPath)
  throw new Error('Workflow metadata is required.');
const event = JSON.parse(await readFile(eventPath, 'utf8'));
let pr: unknown = event.pull_request;
if (process.env.GITHUB_EVENT_NAME === 'workflow_dispatch') {
  const number = String(event.inputs?.['release-pr'] ?? '');
  if (!/^[1-9][0-9]*$/.test(number))
    throw new Error('A merged Release PR number is required.');
  pr = JSON.parse(
    execFileSync('gh', ['api', `repos/${repository}/pulls/${number}`], {
      encoding: 'utf8',
    }),
  );
}
const metadata = releasePullRequest(pr, repository);
await appendFile(output, `source=${metadata.source}\npr=${metadata.number}\n`);
