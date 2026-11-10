import {
  cp,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  rename,
  rm,
  writeFile,
} from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import type { Reporter } from '@kypa/sdk';
export function createPagesReporter(assetsDirectory: string): Reporter {
  return {
    id: 'pages',
    async write(report, options, context) {
      if (
        !options.directory ||
        !options.basePath ||
        !/^\/(?:[A-Za-z0-9_-]+\/)*$/.test(options.basePath)
      )
        throw new Error('Invalid Pages output options.');
      const destination = resolve(context.policyDirectory, options.directory);
      await mkdir(dirname(destination), { recursive: true });
      const stage = await mkdtemp(join(dirname(destination), '.kypa-pages-'));
      try {
        await cp(assetsDirectory, stage, {
          recursive: true,
          dereference: false,
        });
        const index = await readFile(join(stage, 'index.html'), 'utf8');
        await writeFile(
          join(stage, 'index.html'),
          index.replace('<head>', `<head><base href="${options.basePath}">`),
        );
        await writeFile(join(stage, 'data.json'), JSON.stringify(report));
        await writeFile(join(stage, '.nojekyll'), '');
        context.signal?.throwIfAborted();
        try {
          await lstat(destination);
          throw new Error('Output already exists.');
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
        }
        await rename(stage, destination);
      } finally {
        await rm(stage, { recursive: true, force: true });
      }
    },
  };
}
