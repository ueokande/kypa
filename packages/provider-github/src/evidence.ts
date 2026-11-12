import { FatalError } from "@kypa/sdk";
import { z } from "zod";
import { ApiError, type GitHubClient } from "./client.js";
import { EvidenceError } from "./errors.js";
import { type ActionReference, collectReferences } from "./references.js";

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

const blobSchema = z.object({
  encoding: z.literal("base64"),
  content: z.string(),
  size: z.number().int().nonnegative(),
});

const protectionSchema = z.object({
  required_pull_request_reviews: z
    .object({ required_approving_review_count: z.number().int().nonnegative() })
    .nullish(),
});

export function repositoryPath(name: string): string {
  return `/repos/${name.split("/").map(encodeURIComponent).join("/")}`;
}

export async function collectActionReferences(
  api: GitHubClient,
  snapshot: { repository: string; commit: string; tree: string },
  signal?: AbortSignal,
): Promise<{ references: ActionReference[] }> {
  const base = repositoryPath(snapshot.repository);
  const tree = treeSchema.parse(
    await api.get(`${base}/git/trees/${snapshot.tree}?recursive=1`, signal),
  );
  if (tree.truncated) {
    throw new EvidenceError(
      "TRUNCATED_TREE",
      "GitHub returned a truncated repository tree. Action reference coverage is incomplete; the full repository tree must be readable.",
    );
  }
  const candidates = tree.tree.filter(
    (entry) =>
      /^[.]github\/workflows\/[^/]+[.]ya?ml$/.test(entry.path) ||
      /(^|\/)action[.]ya?ml$/.test(entry.path),
  );
  const blobs = new Map<string, Promise<unknown>>();
  const loadBlob = (sha: string): Promise<unknown> => {
    let pending = blobs.get(sha);
    if (!pending) {
      pending = api.get(`${base}/git/blobs/${sha}`, signal);
      blobs.set(sha, pending);
    }
    return pending;
  };
  const results = await Promise.allSettled(
    candidates.map(async (entry) => {
      if (entry.type !== "blob" || !["100644", "100755"].includes(entry.mode)) {
        throw new EvidenceError(
          "UNSUPPORTED_FILE",
          "An Action or workflow file is a symlink or another unsupported file type. Use regular files for complete reference scanning.",
        );
      }
      const blob = blobSchema.parse(await loadBlob(entry.sha));
      if (blob.size > 1_048_576) {
        throw new EvidenceError(
          "FILE_TOO_LARGE",
          "An Action or workflow file exceeds the 1 MiB collection limit. Reference coverage is incomplete.",
        );
      }
      try {
        return collectReferences(
          Buffer.from(blob.content, "base64").toString("utf8"),
          entry.path,
          snapshot.repository,
          snapshot.commit,
        );
      } catch (error) {
        if (error instanceof EvidenceError) {
          throw new EvidenceError(
            error.code,
            `${entry.path}: ${error.message}`,
          );
        }
        throw error;
      }
    }),
  );
  signal?.throwIfAborted();
  // A recoverable file error must not hide a concurrent authentication failure.
  const fatal = results.find(
    (result) =>
      result.status === "rejected" && result.reason instanceof FatalError,
  );
  if (fatal?.status === "rejected") {
    throw fatal.reason;
  }
  const references = results.flatMap((result) => {
    if (result.status === "rejected") {
      throw result.reason;
    }
    return result.value;
  });
  return { references };
}

export async function collectClassicProtection(
  api: GitHubClient,
  repository: string,
  branch: string,
  signal?: AbortSignal,
): Promise<{ minimum: number }> {
  const branchPath = `${repositoryPath(repository)}/branches/${encodeURIComponent(branch)}`;
  try {
    const protection = protectionSchema.parse(
      await api.get(`${branchPath}/protection`, signal),
    );
    return {
      minimum:
        protection.required_pull_request_reviews
          ?.required_approving_review_count ?? 0,
    };
  } catch (error) {
    if (!(error instanceof ApiError) || error.status !== 404) {
      throw error;
    }
    // A 404 alone does not establish absence; account admin is not token access.
    const branchState = z
      .object({ protected: z.boolean() })
      .parse(await api.get(branchPath, signal));
    if (branchState.protected) {
      throw new EvidenceError(
        "PROTECTION_ACCESS",
        "Classic protection returned HTTP 404 for a protected branch. Check Administration read permission; ruleset-based protection is not evaluated by this rule.",
      );
    }
    return { minimum: 0 };
  }
}
