import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as core from '@actions/core';
import { loadPolicy, runScan } from '@kypa/core';
import { createGitHubProvider } from '@kypa/github';
import { createHtmlReporter } from '@kypa/html';
import { jsonReporter } from '@kypa/json';
import { builtInRules } from '@kypa/rules';
import { FatalError, type Policy, type Report, shouldFail } from '@kypa/sdk';

export interface Toolkit {
  getInput(name: string, options?: { required?: boolean }): string;
  setSecret(secret: string): void;
  setOutput(name: string, value: string | number): void;
  setFailed(message: string): void;
  summary: {
    addHeading(text: string): unknown;
    addRaw(text: string): unknown;
    write(): Promise<unknown>;
  };
}
export interface ActionDependencies {
  load: typeof loadPolicy;
  scan: (
    policy: Policy,
    directory: string,
    digest: string,
    token: string,
  ) => Promise<Report>;
}
const defaults: ActionDependencies = {
  load: loadPolicy,
  scan: (policy, directory, digest, token) =>
    runScan(policy, {
      provider: createGitHubProvider({ token, ...policy.scan }),
      rules: builtInRules,
      reporters: [
        jsonReporter,
        createHtmlReporter(
          resolve(dirname(fileURLToPath(import.meta.url)), '../dashboard'),
        ),
      ],
      policyDirectory: directory,
      policyDigest: digest,
    }),
};
export async function run(
  toolkit: Toolkit = core,
  dependencies: ActionDependencies = defaults,
): Promise<void> {
  try {
    const token = toolkit.getInput('token', { required: true });
    if (!token.trim())
      throw new FatalError('AUTHENTICATION', 'A collection token is required.');
    toolkit.setSecret(token);
    const failOn = toolkit.getInput('fail-on') || 'never';
    if (failOn !== 'never' && failOn !== 'violation' && failOn !== 'error')
      throw new FatalError('INPUT', 'Invalid fail-on input.');
    const loaded = await dependencies.load(
      toolkit.getInput('config') || 'kypa.yaml',
      builtInRules,
    );
    const report = await dependencies.scan(
      loaded.policy,
      loaded.directory,
      loaded.digest,
      token,
    );
    toolkit.setOutput('run-id', report.run.id);
    toolkit.setOutput('status', report.run.status);
    toolkit.setOutput('violation-count', report.findings.length);
    toolkit.setOutput('error-count', report.errors.length);
    toolkit.summary.addHeading('Kypa scan');
    toolkit.summary.addRaw(
      `Status: ${report.run.status}\n\nResources: ${report.scope.evaluated}; violations: ${report.findings.length}; errors: ${report.errors.length}\n`,
    );
    await toolkit.summary.write();
    if (shouldFail(report, failOn))
      toolkit.setFailed(
        'The generated scan report triggered the selected failure policy.',
      );
  } catch (error) {
    // Never forward arbitrary exception messages, API bodies, or policy contents to workflow logs.
    toolkit.setFailed(
      error instanceof FatalError
        ? `Kypa failed (${error.code}). This run must not be published.`
        : 'Kypa failed. Check configuration, credentials, and output destinations. This run must not be published.',
    );
  }
}
