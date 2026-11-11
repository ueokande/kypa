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

Keep the Action and common runner in one repository. The main development branch (currently master) tracks TypeScript source and build configuration without generated JavaScript. Exact version tags point to separate generated commits containing source, dist/action, dist/dashboard, and dist/provenance.json. Do not move exact tags or commit build output to master. There is no standalone CLI or npm publication.

### Release PRs

Release PR runs on pushes to master or manual dispatch. It uses the pinned official release-please library to create/update one Release PR from Conventional Commits. Use Conventional Commit titles when squash-merging feature/fix PRs so release-please can calculate changes. Review and merge the Release PR to approve the version and CHANGELOG.md. Keep the generated changelog out of Biome formatting to avoid competing with release-please formatting. The root package version and .release-please-manifest.json must agree at publication. The initial manifest bootstrap value 0.0.0 means no version has been published; the configured first release is 0.1.0. Subsequent pre-1.0 breaking changes bump the minor version.

GitHub Actions settings must allow workflows to create pull requests. The default GITHUB_TOKEN needs contents, pull-requests, and issues write permissions for release automation; no separate PAT or signing key is required. Pull requests created with GITHUB_TOKEN do not automatically trigger another workflow. Use CI's manual dispatch on the Release PR branch for pre-merge checks if required; publication always runs the full check suite after merge. Do not weaken required branch protection to bypass missing checks. Organizations requiring automatic bot-PR checks can supply an appropriately scoped GitHub App/PAT in a separate configuration task.

We call release-please's public Manifest API rather than its Action wrapper to supply lastReleaseSha. A compiled tag is outside master's history; the recorded source SHA in its provenance is the changelog cutoff. Using the compiled tag SHA as that cutoff would repeat old commits. The adapter only calls createPullRequests; release-please must not create a source-only tag first. When the manifest refers to a release not yet tagged, PR generation waits for publication. After a recovered publication, manually dispatch Release PR if newer commits were merged while publication was pending.

### Publication

Publish Action release runs when the same-repository release-please--branches--master PR is merged with the autorelease: pending label. It also accepts a merged Release PR number on manual dispatch for recovery. Eligibility validation checks the repository, base/head branches, labels, merge status, and exact merge SHA; arbitrary source refs and fork PRs are rejected.

The read-only build job checks out that merge SHA, verifies package/manifest versions, runs pnpm check, and uploads compiled artifacts. A separate write-enabled job checks out the same SHA in detached mode, downloads those artifacts, and prepares an annotated version tag on a generated child commit. It pushes only the exact tag, creates GitHub Release notes from the matching changelog section, and changes the PR label to autorelease: tagged. It does not update master, publish an npm package, or configure Pages visibility. The GITHUB_TOKEN-created tag does not need to trigger another workflow: publication completes within this workflow.

The preparation script requires clean, detached source, a matching stable version, and complete regular-file artifacts. It rejects symlinks and records source identity plus SHA-256 hashes. Recovery may reuse an existing tag only if its source parent, version, artifact file list, and actual/recorded hashes match the verified rebuild. Any mismatch stops publication without moving the tag. This allows retry after a tag push succeeds but Release creation or labeling fails. Exact tags stay immutable; moving major aliases such as v1 are not currently published.

Keep all maintenance instructions here and user-facing Action reference instructions in docs/github-action.md. No real version has been published or release workflow dispatched as part of development verification. Unit tests use isolated Git repositories and the official release-please candidate builder; they do not publish remote refs or create PRs.
