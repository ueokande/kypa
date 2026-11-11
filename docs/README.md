# Kypa user manual

> Kypa has an initial source implementation but no published Action release.
> This manual describes the intended first-release interface. Version tags in
> workflow examples are illustrative and are not available releases.

Kypa checks whether resource configuration follows policies defined by your organization. The first release targets GitHub Enterprise Cloud (`github.com`), including organizations with more than 100 internal repositories. It collects default-branch files and GitHub API settings from a central execution repository. No workflow installation, settings changes, or individual owner action is required in target repositories; existing access and organization approvals are still required.

The initial release supports bundled providers, rules, and reporters. YAML selects targets, built-in rules, parameters, and severity. Daily and manual central Actions runs generate JSON and a latest-only static HTML dashboard suitable for any static host. Configure access controls on the chosen host; GitHub Pages is one deployment option. A PAT handles collection without a mandatory GitHub App installation.

| Guide                                 | Use it to                                                    |
| ------------------------------------- | ------------------------------------------------------------ |
| [Getting started](getting-started.md) | Configure central Actions execution and run your first scan. |
| [Authentication](authentication.md)   | Choose a PAT and understand access requirements.             |
| [Configuration](configuration.md)     | Define targets, rules, and output.                           |
| [GitHub Action](github-action.md)     | Schedule scans and publish private results.                  |
| [Rules](rules.md)                     | Understand built-in checks and their limits.                 |
| [Results](results.md)                 | Interpret evaluations, coverage, and freshness.              |

The supported initial entry point is GitHub Actions; no standalone CLI or npm distribution is planned for the initial release. Use a published Action release tag or its reviewed full commit SHA as explained in the [Action guide](github-action.md). No release exists yet.

The first release excludes scan history, diffs, trends, automatic remediation, PR enforcement, and GitHub Enterprise Server. Internal repository visibility does not automatically make Pages private. No OSS license has been selected. Development constraints belong in [AGENTS.md](../AGENTS.md).
