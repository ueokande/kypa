# Contributor guidance

Kypa means **Keep Your Policies Aligned**. It scans resources against centrally defined configuration policies. The initial TypeScript implementation is under development and unreleased. Keep documentation aligned with implemented behavior while clearly marking unreleased Action references.

## Language and documentation

Write repository documentation, code examples, and comments in English. Keep README short. Treat `docs/` as an OSS user manual, not an internal design notebook or development diary. Label concrete interfaces as planned first-release contracts until implemented and released. Never imply unimplemented interfaces or Action tags are available. No OSS license has been selected; do not invent or add one.

## Scope

Initially support GitHub Enterprise Cloud on github.com, including organizations with more than 100 internal repositories. Discover organization repositories, accept explicit repositories, and apply exclusions. Run centrally through daily or manual GitHub Actions without installing workflows or changing settings in target repositories. Existing authentication and authorization remain necessary. Collect default-branch files and GitHub API settings. Do not require a GitHub App. Prefer fine-grained PATs when organization policy and required endpoints permit them. Never assume GITHUB_TOKEN can read other internal repositories.

The initial reports are JSON and a generic static HTML dashboard containing the latest scan only. The hosting service owns access control; GitHub Pages is one deployment option. History, diffs, trends, automatic remediation, PR enforcement, and GitHub Enterprise Server are out of scope.

## Toolchain

Use strict TypeScript and a small pnpm workspace. Use Rsbuild for the dashboard, Rslib for the Action and shared packages, Vitest for tests, and Biome (`@biomejs/biome`) for formatting and lint. Run `tsc --noEmit` separately. Do not add tsup, tsdown, Vite build configuration, or an additional monorepo task orchestrator initially. Use Node.js 24 LTS and the exact pnpm version in package.json. Commit pnpm-lock.yaml and use frozen installations in CI. Run pnpm check for lint, types, tests, builds, and the bundled Action smoke test.

Use namespace imports for node:path: `import * as path from 'node:path'`, with qualified calls such as `path.join(...)`. Avoid named imports from that module.

## Architecture

Keep these components separate through explicit, versioned interfaces:

| Component            | Responsibilities                                                                                                                                                              |
| -------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| SDK                  | Generic resource identity, evidence, evaluations, findings, and internal component contracts. Repository fields must not be mandatory for unrelated resource types.           |
| Provider / collector | Discovery, pagination, API and file collection, normalized evidence, credentials, and API details.                                                                            |
| Rule                 | Declare resource types, required evidence, version, default severity, and runtime parameter schema. Evaluate collected evidence without credentials or network calls.         |
| Core / runner        | Validate policy, resolve built-in components and targets, deduplicate requests, bound concurrency, retry with rate-limit handling, and evaluate rules.                        |
| Reporter             | Consume the common scan report. Initially JSON and static HTML; adding formats must not change rules.                                                                         |
| Action adapter       | Read workflow inputs, call the common runner directly, and translate structured results into outputs, summary, and step success/failure. Keep Actions APIs out of the runner. |

Start with SDK, core, Action adapter, GitHub provider, GitHub rules, JSON reporter, and HTML reporter/dashboard packages. Avoid circular dependencies and unnecessary packages. Internal workspace packages do not imply npm publication. Do not introduce a CLI package, command parser, subprocess boundary, numeric exit-code contract, or npm CLI distribution. Focus the initial release on GitHub Actions. Keep the TypeScript source on the main development branch and generate compiled Action JavaScript in a separate release commit before tagging it. Maintain the Action and common runner in the same repository.

Keep the source structure pluggable through explicit internal provider, rule, and reporter interfaces and dependency injection. Register built-in components centrally so the runner does not depend on individual implementations. Keep credentials and collection in providers, pure evidence evaluation in rules, and common-report rendering in reporters. Validate runtime policy parameters and reject duplicate component IDs. Preserve generic resource identity and versioned evidence so future providers do not require a repository-only model.

External plugins are deferred. Do not implement a public plugin loader, package/module registration in YAML, executable extension discovery, or a published SDK compatibility promise in the initial release. Do not document plugin installation, configuration, or SDK examples in `docs/`; it is the user manual for supported built-in features. Internal interfaces may evolve until an external extension contract is deliberately introduced. Never execute target scripts/workflows or install target dependencies.

## Runner boundary and local verification

Expose a common asynchronous scan function (conceptually `runScan`; its exact signature is not yet a public API). Accept validated configuration and explicit dependencies for collection, reporting, time, and cancellation. Return structured scan/report outcomes; surface fatal failures explicitly. Do not read Actions inputs, mutate workflow outputs, require Actions environment variables, or terminate the process in the runner. The Action adapter reads the token input and passes credentials only to collection dependencies. It maps outcomes and the selected failure policy to step success/failure.

Use local fixture-based Vitest unit tests for pure rules, policy validation, and report rendering. Add runner integration tests using fake collectors, controlled time, and temporary output directories to verify orchestration, partial coverage, and fatal failures without GitHub credentials or the Actions runtime. Test the Action adapter with mocked toolkit inputs/outputs, including failure-policy mapping and safe credential handling. Verify built artifacts and the actual Action in CI for runtime and GitHub integration behavior that local tests cannot establish.

Unit tests are sufficient where they cover the behavior under change; do not add a CLI or mandatory local execution script solely for debugging. If a specific reproduction or live integration diagnosis needs a local harness, add a small development-only script that calls the same runner directly. Such a script is optional, is not a supported user interface, and must not establish a command compatibility promise or require a CLI architecture. Local fixture success does not prove remote permissions or hosted Actions behavior.

## Evaluation and reports

Separate evaluations from findings. Support `pass`, `fail`, `not-applicable`, and `error`; zero findings does not prove success. Errors are never passes. Preserve findings without suppression. Central policy cannot be overridden by target configuration or suppression comments.

Include run identity, timestamps, tool/policy/rule versions, generic resource identity, scanned commit, safe errors, and coverage. Link file locations to the scanned commit. API evidence is observed at collection time and does not form an atomic snapshot with Git evidence. Discovery cannot guarantee visibility of inaccessible repositories.

Violations must not prevent report generation or publication. Fatal configuration, authentication, and output errors prevent publication; keep the previous deployment. Partial reports must clearly show missing coverage. Display freshness prominently.

## Security and validation

Use the PAT only for collection. Keep HTML generation independent of hosting APIs and metadata. Separate scan and host-specific deployment permissions; the GitHub Pages example uses GITHUB_TOKEN and OIDC. Never publish secrets, raw API responses, or unnecessary source content. Escape untrusted rendered data.

Use fixture-based Vitest tests for rules, collection/evaluation failures, and reporters. Validate formatting, lint, types, tests, and relevant builds. Distinguish failed checks from unrun checks. Documentation-only examples cannot be claimed as tested against an implementation.

## Releases and distribution

Keep the Action and common runner in one repository. Master tracks TypeScript source without generated JavaScript. Distribution tags vX.Y.Z point to separate generated commits containing source, dist/action, dist/dashboard, and dist/provenance.json. release-please manages a separate source-vX.Y.Z tag namespace on master. Do not move exact tags or commit build output to master. There is no standalone CLI or npm publication.

### Versioning with the official Action

The Release workflow runs on pushes to master or manual dispatch with an empty source-tag input. Its first job uses the pinned googleapis/release-please-action with manifest configuration to create/update a Release PR from Conventional Commits. Use Conventional Commit titles when squash-merging feature/fix PRs. Review and merge the Release PR to approve package.json, .release-please-manifest.json, and CHANGELOG.md. The configured initial release is 0.1.0; the initial manifest 0.0.0 means no version has been published. Keep the generated changelog out of Biome formatting.

After the Release PR is merged, the Action creates the source-vX.Y.Z tag and source GitHub Release and manages the PR's autorelease labels. Its source component configuration excludes the distribution vX.Y.Z releases from release-please's version history. Source tags remain on master, so no custom changelog cutoff or release-please npm dependency/adapter is required. Both source and distribution GitHub Releases exist for each version; users must reference vX.Y.Z, not source-vX.Y.Z. A source Release alone does not establish that the runnable distribution has been published.

GitHub Actions settings must allow workflows to create pull requests. Standard GITHUB_TOKEN permissions are sufficient; no separate PAT or signing key is required. Bot-created PRs do not automatically trigger another workflow. Use CI's manual dispatch on the Release PR branch for pre-merge checks if needed; publication always runs pnpm check after the source Release is created. Do not weaken branch protection to bypass missing checks. Organization requirements for automatic bot-PR checks can be configured separately with GitHub App/PAT authentication.

### Build and publication

The Action's release_created, tag_name, and sha outputs feed the build job in the same workflow. Do not rely on a second workflow being triggered by the GITHUB_TOKEN-created source tag. Resolve only exact source-vX.Y.Z tags, require their commit to be in origin/master history, and verify the resolved SHA against the Action output. Check out that exact source commit and require the source tag, root package version, and release manifest to agree before installing/building.

The read-only build job runs pnpm check and uploads compiled artifacts. A separate contents-write job checks out the same SHA in detached mode, downloads those artifacts, and prepares an annotated distribution tag on a generated child commit. Push only that tag and create its GitHub Release from the matching changelog section. Source branches remain unchanged; deployment visibility and npm publication are outside this process.

For recovery, manually dispatch Release on master with an existing source-tag such as source-v0.1.0. This skips release-please and rebuilds that exact source without creating another source Release. Build and publication conditions must explicitly allow skipped upstream versioning jobs while respecting workflow cancellation. The preparation script rejects dirty/non-detached source, invalid versions, missing artifacts, and symlinks. It records source identity and SHA-256 hashes. An existing distribution tag can be reused only when its source parent, version, artifact list, and recorded/actual hashes match the rebuild. Mismatches stop publication without moving a tag. This supports retry after a tag push succeeds but GitHub Release creation fails. Moving major aliases are not currently published.

Keep maintenance instructions here and user-facing Action reference instructions in docs/github-action.md. No real release workflow has been dispatched or version published during development verification. Tests use isolated Git repositories and synthetic reports without creating remote tags, releases, or PRs.
