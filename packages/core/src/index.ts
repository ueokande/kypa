import * as crypto from "node:crypto";
import {
  type Evidence,
  FatalError,
  type Policy,
  type Provider,
  type Report,
  type Reporter,
  type Rule,
  resourceKey,
} from "@kypa/sdk";
import packageInfo from "../../../package.json" with { type: "json" };

export { loadPolicy, matchesPattern, parsePolicy, within } from "./config.js";

export async function runScan(
  policy: Policy,
  dependencies: {
    provider: Provider;
    rules: readonly Rule[];
    reporters: readonly Reporter[];
    policyDirectory: string;
    policyDigest: string;
    now?: () => Date;
    runId?: () => string;
    signal?: AbortSignal;
  },
): Promise<Report> {
  const now = dependencies.now ?? (() => new Date());
  const ruleMap = new Map(dependencies.rules.map((rule) => [rule.id, rule]));
  const reporterMap = new Map(
    dependencies.reporters.map((reporter) => [reporter.id, reporter]),
  );
  if (
    ruleMap.size !== dependencies.rules.length ||
    reporterMap.size !== dependencies.reporters.length
  ) {
    throw new FatalError("REGISTRY", "Duplicate component IDs.");
  }
  for (const rule of policy.rules) {
    if (!ruleMap.has(rule.id)) {
      throw new FatalError("REGISTRY", "Unknown rule.");
    }
  }
  for (const reporter of policy.reporters) {
    if (!reporterMap.has(reporter.name)) {
      throw new FatalError("REGISTRY", "Unknown reporter.");
    }
  }
  const startedAt = now().toISOString();
  dependencies.signal?.throwIfAborted();
  const discovery = await dependencies.provider.discover(
    policy.targets,
    dependencies.signal,
  );
  if (!discovery.resources.length && !discovery.errors.length) {
    throw new FatalError("EMPTY_TARGETS", "No effective targets remain.", [
      "No repositories remain after discovery and filters. Check targets.orgs, targets.repos, exclusions, and includeArchived/includeForks.",
    ]);
  }
  const report: Report = {
    schemaVersion: 1,
    run: {
      id: (dependencies.runId ?? crypto.randomUUID)(),
      startedAt,
      completedAt: startedAt,
      toolVersion: packageInfo.version,
      policyVersion: 1,
      policyDigest: dependencies.policyDigest,
      status: "complete",
    },
    scope: {
      requested: policy.targets,
      discovered: discovery.resources.length,
      excluded: discovery.excluded,
      evaluated: 0,
      discoveryLimitedToAccessibleResources: true,
    },
    resources: discovery.resources,
    evaluations: [],
    findings: [],
    errors: [...discovery.errors],
    warnings: [],
  };
  // Resource iteration is sequential; the provider bounds concurrent API requests.
  for (const resource of report.resources) {
    dependencies.signal?.throwIfAborted();
    const applicable = policy.rules.filter((selected) =>
      ruleMap
        .get(selected.id)
        ?.resourceTypes.includes(`${resource.provider}/${resource.type}`),
    );
    const ids = [
      ...new Set(
        applicable.flatMap((selected) => [
          ...(ruleMap.get(selected.id)?.requiredEvidence ?? []),
        ]),
      ),
    ];
    let evidence: Record<string, Evidence>;
    try {
      evidence = ids.length
        ? await dependencies.provider.collect(
            resource,
            ids,
            dependencies.signal,
          )
        : {};
    } catch (error) {
      if (error instanceof FatalError || dependencies.signal?.aborted) {
        throw error;
      }
      evidence = Object.fromEntries(
        ids.map((id) => [
          id,
          {
            state: "unavailable",
            observedAt: now().toISOString(),
            code: "COLLECTION",
            message: "The provider could not collect required evidence.",
          },
        ]),
      );
    }
    const key = resourceKey(resource);
    for (const selected of policy.rules) {
      const rule = ruleMap.get(selected.id);
      if (!rule) {
        throw new FatalError("REGISTRY", "Unknown rule.");
      }
      const evaluation: Report["evaluations"][number] = {
        resource: key,
        rule: rule.id,
        ruleVersion: rule.version,
        severity: selected.severity,
        status: "not-applicable",
        findingIds: [],
        evidence: rule.requiredEvidence.flatMap((id) => {
          const item = evidence[id];
          return item
            ? [{ id, state: item.state, observedAt: item.observedAt }]
            : [];
        }),
      };
      report.evaluations.push(evaluation);
      if (!applicable.includes(selected)) {
        continue;
      }
      const unavailable = rule.requiredEvidence.find(
        (id) => !evidence[id] || evidence[id]?.state === "unavailable",
      );
      if (unavailable) {
        const item = evidence[unavailable];
        report.errors.push({
          phase: "collection",
          resource: key,
          rule: rule.id,
          code: item?.state === "unavailable" ? item.code : "MISSING_EVIDENCE",
          message:
            item?.state === "unavailable"
              ? item.message
              : "Required evidence was not collected.",
        });
        evaluation.status = "error";
        continue;
      }
      try {
        const result = rule.evaluate(resource, evidence, selected.parameters);
        for (const finding of result.findings) {
          const id = crypto
            .createHash("sha256")
            .update(JSON.stringify([key, rule.id, finding.key]))
            .digest("hex");
          report.findings.push({
            ...finding,
            id,
            resource: key,
            rule: rule.id,
            ruleVersion: rule.version,
            severity: selected.severity,
          });
          evaluation.findingIds.push(id);
        }
        evaluation.status = !result.applicable
          ? "not-applicable"
          : result.findings.length
            ? "fail"
            : "pass";
      } catch {
        evaluation.status = "error";
        report.errors.push({
          phase: "evaluation",
          resource: key,
          rule: rule.id,
          code: "EVALUATION",
          message: "Rule could not evaluate the collected evidence.",
        });
      }
    }
    report.scope.evaluated++;
  }
  report.run.completedAt = now().toISOString();
  report.run.status = report.errors.length ? "partial" : "complete";
  for (const [index, selected] of policy.reporters.entries()) {
    dependencies.signal?.throwIfAborted();
    try {
      await reporterMap.get(selected.name)?.write(report, selected.options, {
        policyDirectory: dependencies.policyDirectory,
        ...(dependencies.signal ? { signal: dependencies.signal } : {}),
      });
    } catch (error) {
      dependencies.signal?.throwIfAborted();
      throw new FatalError(
        "OUTPUT",
        "Reporter failed; this run must not be published.",
        [`reporters[${index}]: ${describeOutputError(error)}`],
      );
    }
  }
  return report;
}

function describeOutputError(error: unknown): string {
  const code =
    error && typeof error === "object" && "code" in error
      ? error.code
      : undefined;
  switch (code) {
    case "EACCES":
    case "EPERM":
    case "EROFS":
      return "Cannot write the report. Check output directory permissions and read-only mounts.";
    case "ENOSPC":
      return "Cannot write the report because the filesystem has no space left. Free space and use fresh output destinations.";
    case "EEXIST":
      return "The output destination already exists. Choose a fresh destination.";
    case "ENOENT":
      return "Required output files or dashboard assets are missing. Run pnpm build and check output directory access.";
    default:
      return "Could not generate the report. Check writable output directories, available space, and dashboard build assets.";
  }
}
