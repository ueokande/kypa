# Plugins

> Proposed first-release extension contract. `@kypa/sdk`, its helpers, and the example types below are not implemented or published. Exact TypeScript declarations will be finalized during implementation.

## Trust and registration

Explicitly register trusted installed npm packages or compiled local ESM modules in the central policy. Each module has a default ESM export, plugin ID/version, and SDK compatibility `apiVersion: 1`. Reject incompatible API versions and duplicate plugin or component IDs; do not depend on registration order to overwrite definitions.

Plugins execute as trusted code in the Kypa process. They are not sandboxed. Review and pin dependencies and compile local TypeScript before loading. Kypa never auto-installs or loads plugins from scanned repositories, executes target scripts/workflows, or installs target dependencies. Rules must still obey the no-network/no-credentials contract.

| Extension | Responsibility |
| --- | --- |
| Provider | Discover resources and normalize evidence; own credentials and API details. |
| Rule | Declare applicability/evidence and evaluate collected data with validated parameters. |
| Reporter | Render the common report without collecting or reevaluating evidence. |

Resources have generic identity consisting of provider, type, and stable ID. GitHub repositories are one resource type, not a mandatory model for every future provider. Evidence is namespaced and versioned, such as `github/action-references@1`.

## Proposed rule example

This illustrates intended SDK ergonomics, not compilable software available today. The proposed evidence exposes only remote GitHub references through `remoteReferences`, each with an owner, reference text, path, and line. Local and Docker references are not in that list.

```ts
import { definePlugin, defineRule, schema } from '@kypa/sdk';

const approvedActionOwners = defineRule({
  id: 'company/approved-action-owners',
  version: '1.0.0',
  resourceTypes: ['github/repository'],
  requiredEvidence: ['github/action-references@1'],
  defaultSeverity: 'high',
  parameters: schema.object({
    owners: schema.array(schema.string()),
  }),
  evaluate({ evidence, parameters }) {
    const { remoteReferences } = evidence['github/action-references@1'];
    if (remoteReferences.length === 0) {
      return { applicability: 'not-applicable', findings: [] };
    }

    const allowed = new Set(parameters.owners.map((owner) => owner.toLowerCase()));
    const findings = remoteReferences
      .filter((item) => !allowed.has(item.owner.toLowerCase()))
      .map((item) => ({
        key: JSON.stringify([item.path, item.line, item.reference]),
        message: `Action owner ${item.owner} is not approved.`,
        location: { path: item.path, line: item.line },
        remediation: 'Use an action from an approved owner or request a central policy change.',
      }));

    return { applicability: 'applicable', findings };
  },
});

export default definePlugin({
  id: 'company/policies',
  version: '1.0.0',
  apiVersion: 1,
  rules: [approvedActionOwners],
});
```

The rule returns applicability and findings. The runner computes final severity, stable fingerprints, evaluation status, and exception application; a rule cannot exempt itself. Missing/unavailable evidence must become a collection/evaluation error rather than being replaced with an empty list. Runtime parameter schemas validate untrusted YAML before evaluation. This example checks owner membership only, not action safety or SHA pinning.

Compile with Rslib, including declaration generation, to a local ESM output such as `plugins/company/dist/index.js`. Use fixture-based Vitest tests for approved/unapproved owners, case matching, no remote references, malformed evidence, and failures. SDK/tool versions and exact build configuration will be selected at implementation time.

Register and enable the rule:

```yaml
version: 1
plugins:
  - ./plugins/company/dist/index.js
targets:
  organizations:
    - example-org
rules:
  company/approved-action-owners:
    severity: high
    parameters:
      owners:
        - actions
        - example-org
reporters:
  - name: json
    options:
      path: report/report.json
```

Registration alone does not select a rule. Paths resolve relative to the policy. Alternatively, register an already installed trusted package by its ESM package specifier; Kypa must not install it on demand.

## Reporters

A reporter declares an ID, version, and runtime options schema. Its proposed asynchronous entry point is `write(report, validatedOptions, context)`. It receives the common scan report, validated output options, and runner context; it performs no collection or rule reevaluation. Additional output formats must not require changes to rules.

Use staged output so an incomplete write cannot masquerade as a successful report. Propagate failures to the runner. Any reporter failure is fatal even if another reporter has already written files; the publication workflow must not deploy that run. Do not include credentials, raw API payloads, or unnecessary source text. Escape untrusted values in rendered formats.

## Providers

A provider discovers resources and reports discovery/coverage failures explicitly. It normalizes evidence into `available`, `unavailable`, or `not-applicable` states, distinguishing legitimate absence from failed access. Credentials remain owned by collection and are never exposed in evidence, rule inputs, or reports.

Providers cooperate with runner-managed pagination, cancellation, bounded concurrency, retries, and rate limits. Avoid duplicate requests by identifying evidence consistently. Record observation times and resolved file commits where relevant. The initial `targets.organizations` and `targets.repositories` syntax is a GitHub convenience, not a universal resource model. Configuration syntax for arbitrary future providers is not promised yet.
