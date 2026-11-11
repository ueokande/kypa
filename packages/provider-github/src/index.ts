import { matchesPattern } from '@kypa/core';
import {
  type Discovery,
  type Evidence,
  FatalError,
  type Provider,
  type Resource,
  type TargetConfig,
} from '@kypa/sdk';
import { z } from 'zod';
import { ApiError, type ClientOptions, GitHubClient } from './client.js';
import { collectReferences } from './references.js';

export { ApiError, GitHubClient } from './client.js';

const repoSchema = z.object({
  id: z.number().int(),
  full_name: z.string().regex(/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/),
  archived: z.boolean(),
  fork: z.boolean(),
  default_branch: z.string().nullable(),
  permissions: z.object({ admin: z.boolean().optional() }).optional(),
});
const commitSchema = z.object({
  sha: z.string().regex(/^[a-f0-9]{40}$/),
  commit: z.object({
    tree: z.object({ sha: z.string().regex(/^[a-f0-9]{40}$/) }),
  }),
});
const treeSchema = z.object({
  truncated: z.boolean(),
  tree: z.array(
    z.object({
      path: z.string(),
      mode: z.string(),
      type: z.string(),
      sha: z.string().regex(/^[a-f0-9]{40}$/),
    }),
  ),
});

export function createGitHubProvider(options: ClientOptions): Provider {
  if (!options.token.trim())
    throw new FatalError('AUTHENTICATION', 'A collection token is required.');
  const api = new GitHubClient(options);

  const now = () => new Date((options.now ?? Date.now)()).toISOString();

  return {
    id: 'github',

    async discover(targets: TargetConfig, signal): Promise<Discovery> {
      const result: Discovery = { resources: [], errors: [], excluded: [] };
      const seen = new Set<string>();

      const add = (data: unknown) => {
        const repo = repoSchema.parse(data);
        const name = repo.full_name.toLowerCase();
        if (seen.has(name)) return;
        seen.add(name);
        if (
          (!targets.includeArchived && repo.archived) ||
          (!targets.includeForks && repo.fork) ||
          targets.exclude.some((pattern) => matchesPattern(name, pattern))
        ) {
          result.excluded.push(repo.full_name);
          return;
        }
        result.resources.push({
          provider: 'github',
          type: 'repository',
          id: String(repo.id),
          name: repo.full_name,
          url: `https://github.com/${repo.full_name}`,
          metadata: {
            defaultBranch: repo.default_branch,
            admin: repo.permissions?.admin ?? false,
            archived: repo.archived,
            fork: repo.fork,
          },
        });
      };

      for (const org of [
        ...new Set(targets.organizations.map((value) => value.toLowerCase())),
      ]) {
        try {
          for (let page = 1; ; page++) {
            const repos = z
              .array(z.unknown())
              .parse(
                await api.get(
                  `/orgs/${encodeURIComponent(org)}/repos?type=all&per_page=100&page=${page}`,
                  signal,
                ),
              );
            repos.forEach(add);
            if (repos.length < 100) break;
          }
        } catch (error) {
          if (error instanceof FatalError || signal?.aborted) throw error;
          result.errors.push({
            phase: 'discovery',
            code: 'DISCOVERY',
            message: 'Organization repository discovery could not complete.',
            resource: `github/organization/${org}`,
          });
        }
      }
      for (const name of targets.repositories) {
        if (seen.has(name.toLowerCase())) continue;
        // Exact exclusions can be applied before requesting inaccessible targets.
        if (targets.exclude.some((pattern) => matchesPattern(name, pattern))) {
          result.excluded.push(name);
          continue;
        }
        try {
          add(
            await api.get(
              `/repos/${name.split('/').map(encodeURIComponent).join('/')}`,
              signal,
            ),
          );
        } catch (error) {
          if (error instanceof FatalError || signal?.aborted) throw error;
          result.errors.push({
            phase: 'discovery',
            code: 'REPOSITORY_ACCESS',
            message: 'An explicit repository could not be accessed.',
            resource: `github/repository/${name}`,
          });
        }
      }
      result.resources.sort((a, b) => a.name.localeCompare(b.name));
      return result;
    },

    async collect(
      resource: Resource,
      ids,
      signal,
    ): Promise<Record<string, Evidence>> {
      const result: Record<string, Evidence> = {};
      const base = `/repos/${resource.name.split('/').map(encodeURIComponent).join('/')}`;
      const branch = resource.metadata.defaultBranch;
      let commit: z.infer<typeof commitSchema> | undefined;

      const unavailable = (id: string, error: unknown) => {
        if (error instanceof FatalError || signal?.aborted) throw error;
        result[id] = {
          state: 'unavailable',
          observedAt: now(),
          code:
            error instanceof ApiError
              ? `GITHUB_${error.status}_${error.code}`
              : 'INVALID_EVIDENCE',
          message: 'Required GitHub evidence could not be collected or parsed.',
        };
      };

      if (!branch) {
        for (const id of ids)
          result[id] = { state: 'not-applicable', observedAt: now() };
        return result;
      }
      try {
        commit = commitSchema.parse(
          await api.get(
            `${base}/commits/${encodeURIComponent(String(branch))}`,
            signal,
          ),
        );
        resource.metadata.scannedCommit = commit.sha;
      } catch (error) {
        if (error instanceof ApiError && error.code === 'EMPTY_REPOSITORY') {
          for (const id of ids)
            result[id] = { state: 'not-applicable', observedAt: now() };
          return result;
        }
        for (const id of ids) unavailable(id, error);
        return result;
      }
      for (const id of ids) {
        try {
          if (id === 'github/action-references@1') {
            const tree = treeSchema.parse(
              await api.get(
                `${base}/git/trees/${commit.commit.tree.sha}?recursive=1`,
                signal,
              ),
            );
            if (tree.truncated) throw new Error('Truncated tree.');
            const candidates = tree.tree.filter(
              (entry) =>
                /^[.]github\/workflows\/[^/]+[.]ya?ml$/.test(entry.path) ||
                /(^|\/)action[.]ya?ml$/.test(entry.path),
            );
            const blobs = new Map<string, Promise<unknown>>();
            const references = await Promise.allSettled(
              candidates.map(async (entry) => {
                if (
                  entry.type !== 'blob' ||
                  !['100644', '100755'].includes(entry.mode)
                )
                  throw new Error('Unsupported file mode.');
                const blob = z
                  .object({
                    encoding: z.literal('base64'),
                    content: z.string(),
                    size: z.number().max(1_048_576),
                  })
                  .parse(
                    await (() => {
                      let pending = blobs.get(entry.sha);
                      if (!pending) {
                        pending = api.get(
                          `${base}/git/blobs/${entry.sha}`,
                          signal,
                        );
                        blobs.set(entry.sha, pending);
                      }
                      return pending;
                    })(),
                  );
                return collectReferences(
                  Buffer.from(blob.content, 'base64').toString('utf8'),
                  entry.path,
                  resource.name,
                  commit.sha,
                );
              }),
            );
            const successful = references.flatMap((item) => {
              if (item.status === 'rejected') throw item.reason;
              return item.value;
            });
            result[id] = {
              state: 'available',
              observedAt: now(),
              data: { references: successful },
            };
          } else if (id === 'github/classic-protection@1') {
            try {
              const protection = z
                .object({
                  required_pull_request_reviews: z
                    .object({
                      required_approving_review_count: z
                        .number()
                        .int()
                        .nonnegative(),
                    })
                    .nullable(),
                })
                .parse(
                  await api.get(
                    `${base}/branches/${encodeURIComponent(String(branch))}/protection`,
                    signal,
                  ),
                );
              result[id] = {
                state: 'available',
                observedAt: now(),
                data: {
                  minimum:
                    protection.required_pull_request_reviews
                      ?.required_approving_review_count ?? 0,
                },
              };
            } catch (error) {
              if (!(error instanceof ApiError) || error.status !== 404)
                throw error;
              // A readable branch with protected=false establishes absence. Account privileges alone do not prove token permissions.
              const branchState = z
                .object({ protected: z.boolean() })
                .parse(
                  await api.get(
                    `${base}/branches/${encodeURIComponent(String(branch))}`,
                    signal,
                  ),
                );
              if (branchState.protected) throw error;
              result[id] = {
                state: 'available',
                observedAt: now(),
                data: { minimum: 0 },
              };
            }
          } else throw new Error('Unknown evidence ID.');
        } catch (error) {
          unavailable(id, error);
        }
      }
      return result;
    },
  };
}
