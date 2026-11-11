import * as fsPromises from 'node:fs/promises';
import * as path from 'node:path';
import type { Reporter } from '@kypa/sdk';

export function createHtmlReporter(assetsDirectory: string): Reporter {
  return {
    id: 'html',

    async write(report, options, context) {
      if (
        !options.directory ||
        !options.basePath ||
        !/^\/(?:[A-Za-z0-9_-]+\/)*$/.test(options.basePath)
      )
        throw new Error('Invalid HTML output options.');
      const destination = path.resolve(
        context.policyDirectory,
        options.directory,
      );
      await fsPromises.mkdir(path.dirname(destination), { recursive: true });
      const stage = await fsPromises.mkdtemp(
        path.join(path.dirname(destination), '.kypa-html-'),
      );
      try {
        await fsPromises.cp(assetsDirectory, stage, {
          recursive: true,
          dereference: false,
        });
        const index = await fsPromises.readFile(
          path.join(stage, 'index.html'),
          'utf8',
        );
        await fsPromises.writeFile(
          path.join(stage, 'index.html'),
          index.replace('<head>', `<head><base href="${options.basePath}">`),
        );
        await fsPromises.writeFile(
          path.join(stage, 'data.json'),
          JSON.stringify(report),
        );
        context.signal?.throwIfAborted();
        try {
          await fsPromises.lstat(destination);
          throw new Error('Output already exists.');
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
        }
        await fsPromises.rename(stage, destination);
      } finally {
        await fsPromises.rm(stage, { recursive: true, force: true });
      }
    },
  };
}
