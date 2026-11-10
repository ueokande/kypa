import { link, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import type { Reporter } from '@kypa/sdk';
export const jsonReporter: Reporter = {
  id: 'json',
  async write(report, options, context) {
    if (!options.path) throw new Error('Missing JSON output path.');
    context.signal?.throwIfAborted();
    const destination = resolve(context.policyDirectory, options.path);
    await mkdir(dirname(destination), { recursive: true });
    const stage = await mkdtemp(join(dirname(destination), '.kypa-json-'));
    try {
      const file = join(stage, 'report.json');
      await writeFile(
        file,
        `${JSON.stringify(report, null, 2)}
`,
        { mode: 0o600 },
      );
      context.signal?.throwIfAborted();
      // An exclusive hard link publishes a complete file without replacing existing source.
      await link(file, destination);
    } finally {
      await rm(stage, { recursive: true, force: true });
    }
  },
};
