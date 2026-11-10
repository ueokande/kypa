# Kypa user manual

> Kypa has not been implemented or published yet. This manual defines the
> intended first-release interface. Commands, package names, Action references,
> and SDK examples are proposed contracts, not currently available software.

Kypa checks whether resource configuration follows policies defined by your organization. The first release targets GitHub Enterprise Cloud (`github.com`), including organizations with more than 100 internal repositories. It collects default-branch files and GitHub API settings from a central execution repository. No workflow installation, settings changes, or individual owner action is required in target repositories; existing access and organization approvals are still required.

TypeScript defines checks; YAML selects targets, rules, parameters, severity, and exceptions. Daily and manual central Actions runs generate JSON and a latest-only, access-controlled static Pages dashboard. A PAT handles collection without a mandatory GitHub App installation.

| Guide | Use it to |
| --- | --- |
| [Getting started](getting-started.md) | Prepare central execution and follow a local scan workflow. |
| [Authentication](authentication.md) | Choose a PAT and understand access requirements. |
| [Configuration](configuration.md) | Define targets, rules, exceptions, and output. |
| [GitHub Action](github-action.md) | Schedule scans and publish private results. |
| [Releases and distribution](releases.md) | Choose CLI versions and Action refs from the same repository. |
| [CLI](cli.md) | Validate, inspect rules, scan, and interpret exit codes. |
| [Rules](rules.md) | Understand built-in checks and their limits. |
| [Results](results.md) | Interpret evaluations, coverage, and freshness. |
| [Plugins](plugins.md) | Extend collection, checks, and reporting with trusted code. |
| [Troubleshooting](troubleshooting.md) | Diagnose access, configuration, and publication problems. |

The CLI and GitHub Action share one repository and one scanning implementation. The main development branch retains TypeScript source; versioned Action release commits additionally contain compiled JavaScript. npm distributes the compiled CLI from the same source revision. No release exists yet.

The first release excludes scan history, diffs, trends, automatic remediation, PR enforcement, and GitHub Enterprise Server. Internal repository visibility does not automatically make Pages private. No OSS license has been selected. Development constraints belong in [AGENTS.md](../AGENTS.md).
