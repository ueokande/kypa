# Kypa user manual

> Kypa has not been implemented or published yet. This manual defines the
> intended first-release interface. Action references, workflow examples,
> and examples are proposed contracts, not currently available software.

Kypa checks whether resource configuration follows policies defined by your organization. The first release targets GitHub Enterprise Cloud (`github.com`), including organizations with more than 100 internal repositories. It collects default-branch files and GitHub API settings from a central execution repository. No workflow installation, settings changes, or individual owner action is required in target repositories; existing access and organization approvals are still required.

The initial release supports bundled providers, rules, and reporters. YAML selects targets, built-in rules, parameters, severity, and exceptions. Daily and manual central Actions runs generate JSON and a latest-only, access-controlled static Pages dashboard. A PAT handles collection without a mandatory GitHub App installation.

| Guide | Use it to |
| --- | --- |
| [Getting started](getting-started.md) | Configure central Actions execution and run your first scan. |
| [Authentication](authentication.md) | Choose a PAT and understand access requirements. |
| [Configuration](configuration.md) | Define targets, rules, exceptions, and output. |
| [GitHub Action](github-action.md) | Schedule scans and publish private results. |
| [Releases and distribution](releases.md) | Choose Action release tags and verify their source provenance. |
| [Rules](rules.md) | Understand built-in checks and their limits. |
| [Results](results.md) | Interpret evaluations, coverage, and freshness. |
| [Troubleshooting](troubleshooting.md) | Diagnose access, configuration, and publication problems. |

The GitHub Action calls a common scan runner directly within the same repository. The main development branch retains TypeScript source; versioned Action release commits additionally contain compiled JavaScript. The supported initial entry point is GitHub Actions; no standalone CLI or npm distribution is planned for the initial release. No release exists yet.

The first release excludes scan history, diffs, trends, automatic remediation, PR enforcement, and GitHub Enterprise Server. Internal repository visibility does not automatically make Pages private. No OSS license has been selected. Development constraints belong in [AGENTS.md](../AGENTS.md).
