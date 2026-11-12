import { matchesPattern } from "@kypa/core";
import { type Discovery, FatalError, type TargetConfig } from "@kypa/sdk";
import { z } from "zod";
import { ApiError, type GitHubClient } from "./client.js";
import { describeGitHubError } from "./errors.js";

const repoSchema = z.object({
  id: z.number().int(),
  full_name: z.string().regex(/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/),
  archived: z.boolean(),
  fork: z.boolean(),
  default_branch: z.string().nullable(),
  permissions: z.object({ admin: z.boolean().optional() }).optional(),
});

export async function discoverTargets(
  api: GitHubClient,
  targets: TargetConfig,
  signal?: AbortSignal,
): Promise<Discovery> {
  const result: Discovery = { resources: [], errors: [], excluded: [] };
  const seen = new Set<string>();

  const addRepository = (data: unknown) => {
    const repo = repoSchema.parse(data);
    const name = repo.full_name.toLowerCase();
    if (seen.has(name)) {
      return;
    }
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
      provider: "github",
      type: "repository",
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

  for (const org of uniqueNames(targets.orgs)) {
    try {
      for await (const page of api.paginate(
        `/orgs/${encodeURIComponent(org)}/repos?type=all`,
        signal,
      )) {
        z.array(z.unknown()).parse(page).forEach(addRepository);
      }
    } catch (error) {
      if (error instanceof FatalError || signal?.aborted) {
        throw error;
      }
      const problem = describeGitHubError(error);
      const organizationHint =
        error instanceof ApiError && error.status === 404
          ? " targets.orgs accepts organizations only; for a personal account, list its repositories in targets.repos."
          : "";
      result.errors.push({
        phase: "discovery",
        ...problem,
        message: `Could not list organization repositories. ${problem.message}${organizationHint}`,
        resource: `github/organization/${org}`,
      });
    }
  }
  for (const name of uniqueNames(targets.repos)) {
    if (seen.has(name.toLowerCase())) {
      continue;
    }
    // Exact exclusions can be applied before requesting inaccessible targets.
    if (targets.exclude.some((pattern) => matchesPattern(name, pattern))) {
      result.excluded.push(name);
      continue;
    }
    try {
      addRepository(
        await api.get(
          `/repos/${name.split("/").map(encodeURIComponent).join("/")}`,
          signal,
        ),
      );
    } catch (error) {
      if (error instanceof FatalError || signal?.aborted) {
        throw error;
      }
      result.errors.push({
        phase: "discovery",
        ...describeGitHubError(error),
        resource: `github/repository/${name}`,
      });
    }
  }
  result.resources.sort((a, b) => a.name.localeCompare(b.name));
  return result;
}

function uniqueNames(names: readonly string[]): string[] {
  const unique = new Map<string, string>();
  for (const name of names) {
    const key = name.toLowerCase();
    if (!unique.has(key)) {
      unique.set(key, name);
    }
  }
  return [...unique.values()];
}
