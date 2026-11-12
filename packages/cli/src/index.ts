import * as path from "node:path";
import * as url from "node:url";
import * as util from "node:util";
import { loadPolicy, runScan } from "@kypa/core";
import { createGitHubProvider } from "@kypa/provider-github";
import { createHtmlReporter } from "@kypa/reporter-html";
import { jsonReporter } from "@kypa/reporter-json";
import { builtInRules } from "@kypa/rules-github";
import { FatalError, type Policy, type Report, shouldFail } from "@kypa/sdk";

export interface CliDependencies {
  load: typeof loadPolicy;
  scan: (
    policy: Policy,
    directory: string,
    digest: string,
    token: string,
    signal?: AbortSignal,
  ) => Promise<Report>;
  stdout: (message: string) => void;
  stderr: (message: string) => void;
}

const defaults: CliDependencies = {
  load: loadPolicy,
  scan: (policy, directory, digest, token, signal) =>
    runScan(policy, {
      provider: createGitHubProvider({ token, ...policy.scan }),
      rules: builtInRules,
      reporters: [
        jsonReporter,
        createHtmlReporter(
          path.resolve(
            path.dirname(url.fileURLToPath(import.meta.url)),
            "../dashboard",
          ),
        ),
      ],
      policyDirectory: directory,
      policyDigest: digest,
      ...(signal ? { signal } : {}),
    }),
  stdout: (message) => process.stdout.write(`${message}\n`),
  stderr: (message) => process.stderr.write(`${message}\n`),
};

const help = `Usage: kypa [options]

Scan GitHub repositories using a Kypa policy.

Options:
  -c, --config <path>    Policy file (default: kypa.yaml)
      --fail-on <mode>   never, violation, or error (default: never)
  -h, --help             Show this help

Authentication: GH_TOKEN, falling back to GITHUB_TOKEN.
Exit codes: 0 completed, 1 failure policy triggered, 2 fatal error, 130 cancelled.`;

export async function run(
  args: string[],
  environment: NodeJS.ProcessEnv = process.env,
  dependencies: CliDependencies = defaults,
  signal?: AbortSignal,
): Promise<number> {
  let values: { config?: string; "fail-on"?: string; help?: boolean };
  try {
    ({ values } = util.parseArgs({
      args,
      options: {
        config: { type: "string", short: "c", default: "kypa.yaml" },
        "fail-on": { type: "string", default: "never" },
        help: { type: "boolean", short: "h" },
      },
      strict: true,
      allowPositionals: false,
    }));
  } catch {
    dependencies.stderr("Invalid arguments. Run with --help for usage.");
    return 2;
  }
  if (values.help) {
    dependencies.stdout(help);
    return 0;
  }
  const failOn = values["fail-on"] ?? "never";
  if (failOn !== "never" && failOn !== "violation" && failOn !== "error") {
    dependencies.stderr(
      "Invalid --fail-on value. Use never, violation, or error.",
    );
    return 2;
  }
  const token =
    environment.GH_TOKEN?.trim() || environment.GITHUB_TOKEN?.trim();
  if (!token) {
    dependencies.stderr("Set GH_TOKEN or GITHUB_TOKEN to a collection token.");
    return 2;
  }
  try {
    signal?.throwIfAborted();
    const loaded = await dependencies.load(
      values.config ?? "kypa.yaml",
      builtInRules,
    );
    const report = await dependencies.scan(
      loaded.policy,
      loaded.directory,
      loaded.digest,
      token,
      signal,
    );
    dependencies.stdout(
      `Status: ${report.run.status}\nResources: ${report.scope.evaluated}; violations: ${report.findings.length}; errors: ${report.errors.length}`,
    );
    return shouldFail(report, failOn) ? 1 : 0;
  } catch (error) {
    if (signal?.aborted) {
      dependencies.stderr("Scan cancelled.");
      return 130;
    }
    dependencies.stderr(
      error instanceof FatalError
        ? `Kypa failed (${error.code}). This run must not be published.`
        : "Kypa failed. Check configuration, credentials, and output destinations. This run must not be published.",
    );
    return 2;
  }
}
