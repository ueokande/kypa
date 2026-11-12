export interface ResourceIdentity {
  provider: string;
  type: string;
  id: string;
}

export function resourceKey(resource: ResourceIdentity): string {
  return `${resource.provider}/${resource.type}/${resource.id}`;
}

export const severities = [
  "info",
  "low",
  "medium",
  "high",
  "critical",
] as const;

export type Severity = (typeof severities)[number];

export interface Resource extends ResourceIdentity {
  name: string;
  url: string;
  metadata: Record<string, string | boolean | number | null>;
}

export type Evidence =
  | { state: "available"; observedAt: string; data: unknown }
  | { state: "not-applicable"; observedAt: string }
  | { state: "unavailable"; observedAt: string; code: string; message: string };

export interface Location {
  path: string;
  line: number;
  url?: string;
}

export interface FindingDraft {
  key: string;
  message: string;
  remediation: string;
  location?: Location;
}

export interface Finding extends FindingDraft {
  id: string;
  resource: string;
  rule: string;
  ruleVersion: string;
  severity: Severity;
}

export interface Rule {
  id: string;
  version: string;
  resourceTypes: readonly string[];
  requiredEvidence: readonly string[];
  defaultSeverity: Severity;

  validateParameters(input: unknown): unknown;

  evaluate(
    resource: Resource,
    evidence: Record<string, Evidence>,
    parameters: unknown,
  ): {
    applicable: boolean;
    findings: FindingDraft[];
  };
}

export interface ScanError {
  phase: "discovery" | "collection" | "evaluation";
  code: string;
  message: string;
  resource?: string;
  rule?: string;
}

export interface Discovery {
  resources: Resource[];
  errors: ScanError[];
  excluded: string[];
}

export interface TargetConfig {
  organizations: string[];
  repositories: string[];
  exclude: string[];
  includeArchived: boolean;
  includeForks: boolean;
}

export interface ScanSettings {
  concurrency: number;
  retries: number;
  requestTimeoutSeconds: number;
}

export interface Provider {
  id: string;

  discover(targets: TargetConfig, signal?: AbortSignal): Promise<Discovery>;

  collect(
    resource: Resource,
    evidenceIds: readonly string[],
    signal?: AbortSignal,
  ): Promise<Record<string, Evidence>>;
}

export interface Evaluation {
  resource: string;
  rule: string;
  ruleVersion: string;
  severity: Severity;
  status: "pass" | "fail" | "not-applicable" | "error";
  findingIds: string[];
  evidence: { id: string; state: Evidence["state"]; observedAt: string }[];
}

export interface Report {
  schemaVersion: 1;
  run: {
    id: string;
    startedAt: string;
    completedAt: string;
    toolVersion: string;
    policyVersion: 1;
    policyDigest: string;
    status: "complete" | "partial";
  };
  scope: {
    requested: TargetConfig;
    discovered: number;
    excluded: string[];
    evaluated: number;
    discoveryLimitedToAccessibleResources: true;
  };
  resources: Resource[];
  evaluations: Evaluation[];
  findings: Finding[];
  errors: ScanError[];
  warnings: string[];
}

export interface Reporter {
  id: string;

  write(
    report: Report,
    options: Record<string, string>,
    context: { policyDirectory: string; signal?: AbortSignal },
  ): Promise<void>;
}

export interface RuleSelection {
  id: string;
  severity: Severity;
  parameters: unknown;
}

export interface Policy {
  version: 1;
  targets: TargetConfig;
  scan: ScanSettings;
  rules: RuleSelection[];
  reporters: { name: string; options: Record<string, string> }[];
}

export class FatalError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    // Printable diagnostics must use trusted schema names and descriptions,
    // never raw configuration values or arbitrary exception messages.
    public readonly diagnostics: readonly string[] = [],
  ) {
    super(message);
    this.name = "FatalError";
  }
}

export function formatFailure(error: unknown): string {
  if (error instanceof FatalError) {
    return [
      `Kypa failed (${error.code}).`,
      ...error.diagnostics,
      "This run must not be published.",
    ].join("\n");
  }
  return "Kypa failed. Check configuration, credentials, and output destinations. This run must not be published.";
}

export function shouldFail(
  report: Report,
  policy: "never" | "violation" | "error",
): boolean {
  return (
    (policy !== "never" && report.errors.length > 0) ||
    (policy === "violation" && report.findings.length > 0)
  );
}
