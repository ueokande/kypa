import * as crypto from 'node:crypto';
import * as fsPromises from 'node:fs/promises';
import * as path from 'node:path';
import { FatalError, type Policy, type Rule, severities } from '@kypa/sdk';
import { parseDocument } from 'yaml';
import { z } from 'zod';

const component = '[A-Za-z0-9_.-]+';
const repository = z.string().regex(new RegExp(`^${component}/${component}$`));
const pattern = z
  .string()
  .regex(/^[A-Za-z0-9_.*-]+\/[A-Za-z0-9_.*-]+$/)
  .refine((value) => !value.includes('**'));
const options = z
  .object({
    enabled: z.boolean().default(true),
    severity: z.enum(severities).optional(),
    parameters: z.unknown().optional(),
  })
  .strict();
const rawPolicy = z
  .object({
    version: z.literal(1),
    targets: z
      .object({
        organizations: z
          .array(z.string().regex(new RegExp(`^${component}$`)))
          .default([]),
        repositories: z.array(repository).default([]),
        exclude: z.array(pattern).default([]),
        includeArchived: z.boolean().default(false),
        includeForks: z.boolean().default(false),
      })
      .strict()
      .refine(
        (value) => value.organizations.length + value.repositories.length > 0,
      ),
    scan: z
      .object({
        concurrency: z.number().int().min(1).max(64).default(4),
        retries: z.number().int().min(0).max(10).default(3),
        requestTimeoutSeconds: z.number().int().min(1).max(300).default(30),
      })
      .strict()
      .default({ concurrency: 4, retries: 3, requestTimeoutSeconds: 30 }),
    rules: z.record(z.string(), options),
    reporters: z
      .array(
        z.discriminatedUnion('name', [
          z
            .object({
              name: z.literal('json'),
              options: z.object({ path: z.string().min(1) }).strict(),
            })
            .strict(),
          z
            .object({
              name: z.literal('html'),
              options: z
                .object({
                  directory: z.string().min(1),
                  basePath: z.string().regex(/^\/(?:[A-Za-z0-9_-]+\/)*$/),
                })
                .strict(),
            })
            .strict(),
        ]),
      )
      .min(1),
  })
  .strict();

export function parsePolicy(text: string, rules: readonly Rule[]): Policy {
  const doc = parseDocument(text, { uniqueKeys: true });
  if (doc.errors.length)
    throw new FatalError(
      'CONFIG',
      'Policy YAML is invalid or contains duplicate keys.',
    );
  const parsed = rawPolicy.safeParse(doc.toJS({ maxAliasCount: 50 }));
  if (!parsed.success)
    throw new FatalError(
      'CONFIG',
      'Policy fields are invalid; check the configuration reference.',
    );
  const registry = new Map(rules.map((rule) => [rule.id, rule]));
  if (registry.size !== rules.length)
    throw new FatalError('REGISTRY', 'Duplicate rule IDs.');
  const selected: Policy['rules'] = [];
  for (const [id, setting] of Object.entries(parsed.data.rules)) {
    const rule = registry.get(id);
    if (!rule)
      throw new FatalError('CONFIG', 'Policy selects an unknown rule.');
    let parameters: unknown;
    try {
      parameters = rule.validateParameters(setting.parameters ?? {});
    } catch {
      throw new FatalError('CONFIG', 'Rule parameters are invalid.');
    }
    if (setting.enabled)
      selected.push({
        id,
        severity: setting.severity ?? rule.defaultSeverity,
        parameters,
      });
  }
  if (!selected.length)
    throw new FatalError('CONFIG', 'At least one enabled rule is required.');
  return { ...parsed.data, rules: selected };
}

export function matchesPattern(name: string, pattern: string): boolean {
  const escaped = pattern
    .split('*')
    .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .join('[^/]*');
  return new RegExp(`^${escaped}$`, 'i').test(name);
}

export function within(parent: string, child: string): boolean {
  const rel = path.relative(parent, child);
  return (
    rel === '' ||
    (!path.isAbsolute(rel) && rel !== '..' && !rel.startsWith(`..${path.sep}`))
  );
}

async function canonical(localPath: string): Promise<string> {
  try {
    return await fsPromises.realpath(localPath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    const parent = path.dirname(localPath);
    if (parent === localPath) return localPath;
    return path.resolve(
      await canonical(parent),
      path.relative(parent, localPath),
    );
  }
}

export async function loadPolicy(
  localPath: string,
  rules: readonly Rule[],
): Promise<{ policy: Policy; directory: string; digest: string }> {
  const policyPath = await fsPromises.realpath(path.resolve(localPath));
  const directory = path.dirname(policyPath);
  const text = await fsPromises.readFile(policyPath, 'utf8');
  const policy = parsePolicy(text, rules);
  const destinations: string[] = [];
  for (const reporter of policy.reporters) {
    const destination = await canonical(
      path.resolve(
        directory,
        reporter.options.path ?? reporter.options.directory ?? '',
      ),
    );
    if (
      !within(directory, destination) ||
      destination === directory ||
      within(destination, policyPath)
    ) {
      throw new FatalError(
        'OUTPUT_PATH',
        'Outputs must be dedicated paths beneath the policy directory.',
      );
    }
    for (const other of destinations)
      if (within(other, destination) || within(destination, other))
        throw new FatalError('OUTPUT_PATH', 'Reporter destinations overlap.');
    try {
      await fsPromises.lstat(destination);
      throw new FatalError(
        'OUTPUT_PATH',
        'Output destination already exists; use a fresh generated destination.',
      );
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    destinations.push(destination);
  }
  return {
    policy,
    directory,
    digest: crypto.createHash('sha256').update(text).digest('hex'),
  };
}
