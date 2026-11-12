import type { z } from "zod";

// Only schema-owned names are printable. Record keys and unknown YAML fields
// may contain credentials or other user-controlled text.
const fields = new Set([
  "version",
  "targets",
  "orgs",
  "repos",
  "exclude",
  "includeArchived",
  "includeForks",
  "scan",
  "concurrency",
  "retries",
  "requestTimeoutSeconds",
  "rules",
  "enabled",
  "severity",
  "parameters",
  "reporters",
  "name",
  "options",
  "path",
  "directory",
  "basePath",
  "minimum",
]);

export function policyDiagnostics(
  issues: readonly z.core.$ZodIssue[],
  rules: ReadonlySet<string>,
): string[] {
  return issues.slice(0, 10).map((issue) => {
    let location = "";
    for (const [index, field] of issue.path.entries()) {
      if (typeof field === "number") {
        location += `[${field}]`;
      } else if (index === 1 && issue.path[0] === "rules") {
        location +=
          typeof field === "string" && rules.has(field)
            ? `["${field}"]`
            : "[rule]";
      } else {
        location += fields.has(String(field))
          ? `${location ? "." : ""}${String(field)}`
          : "[field]";
      }
    }
    return `${location || "policy"}: ${explanation(issue)}`;
  });
}

function explanation(issue: z.core.$ZodIssue): string {
  if (issue.code === "unrecognized_keys") {
    return "Unknown fields are not supported. Check the configuration reference.";
  }
  const field = issue.path.at(-1);
  if (field === "basePath") {
    return 'Use an absolute URL path starting and ending with "/", such as "/" or "/report/". Each segment may contain letters, digits, hyphens, or underscores.';
  }
  if (field === "version") {
    return "Use version: 1.";
  }
  if (issue.code === "invalid_type") {
    return `Expected ${issue.expected}. Check that the field is present and has the correct type.`;
  }
  if (issue.code === "too_small") {
    return `The minimum allowed size or value is ${issue.minimum}.`;
  }
  if (issue.code === "too_big") {
    return `The maximum allowed size or value is ${issue.maximum}.`;
  }
  if (issue.code === "invalid_union") {
    return "Choose a supported reporter name: json or html, with its required options.";
  }
  if (issue.code === "custom" && field === "targets") {
    return "Select at least one organization or repository.";
  }
  if (issue.code === "invalid_format") {
    return "Use a valid organization name, owner/repository name, or exclusion pattern. Exclusion patterns support single * wildcards.";
  }
  if (field === "severity") {
    return "Use info, low, medium, high, or critical.";
  }
  return "Invalid value. Check the configuration reference.";
}
