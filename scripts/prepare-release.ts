import { prepareRelease } from './release.ts';

const version = process.env.RELEASE_VERSION;
if (!version) throw new Error('RELEASE_VERSION is required.');
const result = await prepareRelease(process.cwd(), version);
console.log(
  `Prepared ${version}: source ${result.source}, release commit ${result.commit}.`,
);
