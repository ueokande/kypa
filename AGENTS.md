# Contributor guidance

Kypa means **Keep Your Policies Aligned**. It scans resources against centrally defined configuration policies. The software is currently unimplemented and unpublished. This task establishes documentation, not executable software.

## Language and documentation

Write repository documentation, code examples, and comments in English. Keep README short. Treat `docs/` as an OSS user manual, not an internal design notebook or development diary. Label concrete interfaces as planned first-release contracts until implemented and released. Never imply proposed packages, SDK helpers, CLI commands, or Action tags are available. No OSS license has been selected; do not invent or add one.

## Scope

Initially support GitHub Enterprise Cloud on github.com, including organizations with more than 100 internal repositories. Discover organization repositories, accept explicit repositories, and apply exclusions. Run centrally through daily or manual GitHub Actions without installing workflows or changing settings in target repositories. Existing authentication and authorization remain necessary. Collect default-branch files and GitHub API settings. Do not require a GitHub App. Prefer fine-grained PATs when organization policy and required endpoints permit them. Never assume GITHUB_TOKEN can read other internal repositories.

The initial reports are JSON and an access-controlled static GitHub Pages dashboard containing the latest scan only. History, diffs, trends, automatic remediation, PR enforcement, and GitHub Enterprise Server are out of scope.

## Toolchain

Use strict TypeScript and a small pnpm workspace. Use Rsbuild for the dashboard, Rslib for CLI and shared packages, Vitest for tests, and Biome (`@biomejs/biome`) for formatting and lint. Run `tsc --noEmit` separately. Do not add tsup, tsdown, Vite build configuration, or an additional monorepo task orchestrator initially. Select supported stable releases and compatible Node.js LTS when implementation starts, and commit the pnpm lockfile then.

## Architecture

Keep these components separate through explicit, versioned interfaces:

| Component | Responsibilities |
| --- | --- |
| SDK | Generic resource identity, evidence, evaluations, findings, and internal component contracts. Repository fields must not be mandatory for unrelated resource types. |
| Provider / collector | Discovery, pagination, API and file collection, normalized evidence, credentials, and API details. |
| Rule | Declare resource types, required evidence, version, default severity, and runtime parameter schema. Evaluate collected evidence without credentials or network calls. |
| Core / runner | Validate policy, resolve built-in components and targets, deduplicate requests, bound concurrency, retry with rate-limit handling, evaluate rules, and apply exceptions. |
| Reporter | Consume the common scan report. Initially JSON and static Pages; adding formats must not change rules. |
| CLI / Action | CLI owns orchestration; the GitHub Action wraps the CLI. |

Start with SDK, core, CLI, GitHub provider, GitHub rules, JSON reporter, and Pages reporter/dashboard packages. Avoid circular dependencies and unnecessary packages.

Keep the source structure pluggable through explicit internal provider, rule, and reporter interfaces and dependency injection. Register built-in components centrally so the runner does not depend on individual implementations. Keep credentials and collection in providers, pure evidence evaluation in rules, and common-report rendering in reporters. Validate runtime policy parameters and reject duplicate component IDs. Preserve generic resource identity and versioned evidence so future providers do not require a repository-only model.

External plugins are deferred. Do not implement a public plugin loader, package/module registration in YAML, executable extension discovery, or a published SDK compatibility promise in the initial release. Do not document plugin installation, configuration, or SDK examples in `docs/`; it is the user manual for supported built-in features. Internal interfaces may evolve until an external extension contract is deliberately introduced. Never execute target scripts/workflows or install target dependencies.

## Evaluation and reports

Separate evaluations from findings. Support `pass`, `fail`, `not-applicable`, `exempt`, and `error`; zero findings does not prove success. Errors are never passes and cannot be exempted. Preserve original findings and all matching exception metadata. Central policy cannot be overridden by target configuration or suppression comments.

Include run identity, timestamps, tool/policy/rule versions, generic resource identity, scanned commit, safe errors, and coverage. Link file locations to the scanned commit. API evidence is observed at collection time and does not form an atomic snapshot with Git evidence. Discovery cannot guarantee visibility of inaccessible repositories.

Violations must not prevent report generation or publication. Fatal configuration, authentication, and output errors prevent publication; keep the previous deployment. Partial reports must clearly show missing coverage. Display freshness prominently.

## Security and validation

Use the PAT only for collection. Use GITHUB_TOKEN and OIDC for Pages deployment, separating scan and deployment permissions. Never publish secrets, raw API responses, or unnecessary source content. Escape untrusted rendered data.

Use fixture-based Vitest tests for rules, exceptions, collection/evaluation failures, and reporters. Validate formatting, lint, types, tests, and relevant builds. Distinguish failed checks from unrun checks. Documentation-only examples cannot be claimed as tested against an implementation.
