# Contributor guidance

Kypa means **Keep Your Policies Aligned**. It scans resources against centrally defined configuration policies. The initial TypeScript implementation is under development and unreleased. Keep documentation aligned with implemented behavior while clearly marking unreleased Action references.

## Language and documentation

Write repository documentation, code examples, and comments in English. Keep README short. Treat `docs/` as an OSS user manual, not an internal design notebook or development diary. Label concrete interfaces as planned first-release contracts until implemented and released. Never imply unimplemented interfaces or Action tags are available. No OSS license has been selected; do not invent or add one.

## Scope

Initially support GitHub Enterprise Cloud on github.com, including organizations with more than 100 internal repositories. Discover organization repositories, accept explicit repositories, and apply exclusions. Run centrally through daily or manual GitHub Actions without installing workflows or changing settings in target repositories. Existing authentication and authorization remain necessary. Collect default-branch files and GitHub API settings. Do not require a GitHub App. Prefer fine-grained PATs when organization policy and required endpoints permit them. Never assume GITHUB_TOKEN can read other internal repositories.

The initial reports are JSON and a generic static HTML dashboard containing the latest scan only. The hosting service owns access control; GitHub Pages is one deployment option. History, diffs, trends, automatic remediation, PR enforcement, and GitHub Enterprise Server are out of scope.

## Toolchain

Use strict TypeScript and a small pnpm workspace. Use Rsbuild for the dashboard, Rslib for the Action and shared packages, Vitest for tests, and Biome (`@biomejs/biome`) for formatting and lint. Run `tsc --noEmit` separately. Do not add tsup, tsdown, Vite build configuration, or an additional monorepo task orchestrator initially. Use Node.js 24 LTS and the exact pnpm version in package.json. Commit pnpm-lock.yaml and use frozen installations in CI. Run pnpm check for lint, types, tests, builds, and the bundled Action smoke test.

Prefer supported dependency versions that satisfy pnpm's minimum release age. Keep `minimumReleaseAgeStrict` enabled. Do not add package/version-specific `minimumReleaseAgeExclude` entries merely to adopt the latest version; an exception needs a concrete requirement unavailable in mature supported versions.

## Workflow dependencies

Use readable exact version tags in workflow `uses:` entries and commit `.github/workflows/actions.lock`. GitHub Actions resolves dependencies to the commits and repository identities recorded in this native workflow lockfile. Keep every workflow and transitive Action dependency covered. All current dependencies are JavaScript Actions without nested `uses:` dependencies.

Use GitHub's official `gh-actions-lock` extension to maintain the lockfile. Run `gh actions-lock` after changing workflow dependencies, review the resulting refs, commits, and repository identities, and commit the workflow and lockfile together. Use `gh actions-lock --relock` only for deliberate dependency updates. Never automatically accept moved tags. The initial lockfile was assembled without GitHub API access using Git refs, Action metadata, and owner/repository IDs published on github.com; the pnpm setup pin records the commit behind its former annotated-tag object.

`gh actions-lock --verify-local` checks coverage offline; it does not authenticate repository identities or verify remote provenance. There is no dedicated lockfile verification job in CI. GitHub Actions performs native lockfile validation when starting jobs. Where API access is available, use `gh actions-lock --verify` for an additional read-only provenance check before merging.

## Node.js imports

Use namespace imports for the following function-oriented built-in modules. This is a project convention, not a built-in Biome rule. Apply it consistently to application source, tests, and development/release scripts.

| Module                 | Namespace        |
| ---------------------- | ---------------- |
| `node:path`            | `path`           |
| `node:fs`              | `fs`             |
| `node:fs/promises`     | `fsPromises`     |
| `node:crypto`          | `crypto`         |
| `node:os`              | `os`             |
| `node:url`             | `url`            |
| `node:child_process`   | `childProcess`   |
| `node:timers`          | `timers`         |
| `node:timers/promises` | `timersPromises` |

Use qualified members such as `path.join(...)`, `fsPromises.readFile(...)`, and `crypto.createHash(...)`; do not destructure these namespaces. Use the same namespace even when importing only one member. Keep `fs` and `fsPromises` distinct so adding synchronous APIs does not require renaming existing imports. Prefer static imports; if lazy loading is necessary, retain the dynamic import's namespace rather than destructuring it.

Keep the existing default import for assertions, such as `import assert from 'node:assert/strict'`. Type-only named imports using `import type { ... }` are allowed. External libraries and internal workspace packages are outside this convention. Other built-in modules remain a case-by-case choice; add frequently used function-oriented modules to this table when adopting a consistent convention. Rename conflicting local bindings to descriptive names instead of inventing namespace aliases.

Do not add a blanket Biome restriction that rejects allowed type-only imports or changes assertion imports. Record and review this convention here unless equivalent lint enforcement can preserve all exceptions.

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

Keep built-in component packages named by role and implementation:

| Package                 | Directory                  | Role                                               |
| ----------------------- | -------------------------- | -------------------------------------------------- |
| `@kypa/provider-github` | `packages/provider-github` | GitHub resource discovery and evidence collection. |
| `@kypa/rules-github`    | `packages/rules-github`    | Built-in GitHub evidence evaluation rules.         |
| `@kypa/reporter-json`   | `packages/reporter-json`   | JSON report output.                                |
| `@kypa/reporter-html`   | `packages/reporter-html`   | Portable HTML reporter and dashboard.              |

The shared `@kypa/sdk`, `@kypa/core`, and `@kypa/action` packages retain their existing names. Use the same role-based naming for future built-in component packages. These names do not imply an external plugin API or npm publication.

Avoid circular dependencies and unnecessary packages. Internal workspace packages do not imply npm publication. Do not introduce a CLI package, command parser, subprocess boundary, numeric exit-code contract, or npm CLI distribution. Focus the initial release on GitHub Actions. Keep the TypeScript source on the main development branch and generate compiled Action JavaScript in a separate release commit before tagging it. Maintain the Action and common runner in the same repository.

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

Use octokit for GitHub authentication, REST requests, response handling, Link-based pagination, retries, and rate-limit throttling. Keep it inside the GitHub provider. Use p-queue for configured concurrency, queued cancellation, and task timeouts; forward its task signal to Octokit. Avoid custom semaphore, retry, or sleep implementations. A task timeout includes Octokit's throttling and retry delays after leaving the local queue. Convert Octokit errors to safe domain errors and do not log raw request or response metadata. Reject external pagination destinations and redirects before sending credentials.

Use fixture-based Vitest tests for rules, collection/evaluation failures, and reporters. Validate formatting, lint, types, tests, and relevant builds. Distinguish failed checks from unrun checks. Documentation-only examples cannot be claimed as tested against an implementation.

## Releases and distribution

Keep the Action and common runner in one repository. Master tracks TypeScript source without generated JavaScript. Distribution tags vX.Y.Z point to separate generated commits containing source, dist/action, and dist/dashboard. release-please manages a separate source-vX.Y.Z tag namespace on master. Do not move exact tags or commit build output to master. There is no standalone CLI or npm publication.

### Versioning with the official Action

The Release workflow runs automatically on pushes to master. Its first job uses the pinned googleapis/release-please-action with manifest configuration to create/update a Release PR from Conventional Commits. Use Conventional Commit titles when squash-merging feature/fix PRs. Review and merge the Release PR to approve package.json, .release-please-manifest.json, and CHANGELOG.md. The configured initial release is 0.1.0; the initial manifest 0.0.0 means no version has been published. Keep the generated changelog out of Biome formatting.

After the Release PR is merged, the Action creates the source-vX.Y.Z tag and source GitHub Release and manages the PR's autorelease labels. Its source component configuration excludes the distribution vX.Y.Z releases from release-please's version history. Source tags remain on master, so no custom changelog cutoff or release-please npm dependency/adapter is required. Both source and distribution GitHub Releases exist for each version; users must reference vX.Y.Z, not source-vX.Y.Z. A source Release alone does not establish that the runnable distribution has been published.

GitHub Actions settings must allow workflows to create pull requests. Standard GITHUB_TOKEN permissions are sufficient; no separate PAT or signing key is required. Bot-created PRs do not automatically trigger another workflow. Use CI's manual dispatch on the Release PR branch for pre-merge checks if needed; publication always runs pnpm check after the source Release is created. Do not weaken branch protection to bypass missing checks. Organization requirements for automatic bot-PR checks can be configured separately with GitHub App/PAT authentication.

### Build and publication

The Action's release_created, tag_name, and sha outputs feed the build job in the same workflow; GITHUB_TOKEN-created source tags do not trigger another workflow. Build only when release_created is true. Check out the exact SHA returned by release-please and derive the distribution version by removing the source- prefix from its tag_name. There are no manual release inputs, tag-resolution checks, or package-version checks.

The read-only build job runs pnpm check, including the bundled Action smoke test, and uploads compiled artifacts. The smoke test owns build-entry-point validation. A separate contents-write job checks out the same SHA in detached mode and downloads those artifacts. Retrieve the source GitHub Release body with gh release view; stop if retrieval fails. Shell Git commands commit only dist/action and dist/dashboard, create an annotated distribution tag, and push only that tag. Native git tag and git push failures stop existing tags from being overwritten; never force-push an exact version tag. Create the distribution GitHub Release with the copied body and --verify-tag. Do not parse CHANGELOG.md. Master stays source-only. No provenance JSON, artifact hashing, custom tag-reuse logic, or release TypeScript helpers are needed.

Keep maintenance instructions here and user-facing Action reference instructions in docs/github-action.md. tests/smoke/ contains the bundled Action smoke test and its synthetic GitHub fixture. Run pnpm build followed by pnpm test:smoke to test the built Action, or pnpm check for the full validation sequence. Verify workflow Shell changes in disposable Git repositories without pushing real tags or publishing Releases during development.
