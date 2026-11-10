import { GitHub, Manifest } from 'release-please';
import { releaseBaseline } from './release-policy.ts';

const token = process.env.GH_TOKEN;
const repository = process.env.GITHUB_REPOSITORY;
if (
  !token ||
  !repository ||
  !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository)
)
  throw new Error('Repository and workflow token are required.');
const baseline = await releaseBaseline(process.cwd());
if (baseline === null) {
  console.log(
    'The merged Release PR is awaiting artifact publication; no new Release PR will be opened.',
  );
} else {
  const [owner, repo] = repository.split('/');
  if (!owner || !repo) throw new Error('Invalid repository.');
  const github = await GitHub.create({
    owner,
    repo,
    token,
    defaultBranch: 'master',
  });
  // Distribution tags are off the source branch. Stop changelog history at their recorded source commit instead.
  const manifest = await Manifest.fromManifest(
    github,
    'master',
    'release-please-config.json',
    '.release-please-manifest.json',
    baseline ? { lastReleaseSha: baseline } : {},
  );
  await manifest.createPullRequests();
}
