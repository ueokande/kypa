# Contributor guidance

Kypa means **Keep Your Policies Aligned**. It scans resources against centrally defined configuration policies. The initial TypeScript implementation is under development and unreleased. Keep documentation aligned with implemented behavior while clearly marking unreleased Action references.

## Language and documentation

Write repository documentation, code examples, and comments in English. Keep README short. Treat `docs/` as an OSS user manual, not an internal design notebook or development diary. Label concrete interfaces as planned first-release contracts until implemented and released. Never imply unimplemented interfaces or Action tags are available. No OSS license has been selected; do not invent or add one.

## Scope

Initially support GitHub Enterprise Cloud on github.com, including organizations with more than 100 internal repositories. Discover organization repositories, accept explicit repositories, and apply exclusions. Run centrally through daily or manual GitHub Actions without installing workflows or changing settings in target repositories. Existing authentication and authorization remain necessary. Collect default-branch files and GitHub API settings. Do not require a GitHub App. Prefer fine-grained PATs when organization policy and required endpoints permit them. Never assume GITHUB_TOKEN can read other internal repositories.

The initial reports are JSON and an access-controlled static GitHub Pages dashboard containing the latest scan only. History, diffs, trends, automatic remediation, PR enforcement, and GitHub Enterprise Server are out of scope.

## Toolchain

Use strict TypeScript and a small pnpm workspace. Use Rsbuild for the dashboard, Rslib for the Action and shared packages, Vitest for tests, and Biome (`@biomejs/biome`) for formatting and lint. Run `tsc --noEmit` separately. Do not add tsup, tsdown, Vite build configuration, or an additional monorepo task orchestrator initially. Use Node.js 24 LTS and the exact pnpm version in package.json. Commit pnpm-lock.yaml and use frozen installations in CI. Run pnpm check for lint, types, tests, builds, and the bundled Action smoke test.

## Architecture

Keep these components separate through explicit, versioned interfaces:

| Component            | Responsibilities                                                                                                                                                              |
| -------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| SDK                  | Generic resource identity, evidence, evaluations, findings, and internal component contracts. Repository fields must not be mandatory for unrelated resource types.           |
| Provider / collector | Discovery, pagination, API and file collection, normalized evidence, credentials, and API details.                                                                            |
| Rule                 | Declare resource types, required evidence, version, default severity, and runtime parameter schema. Evaluate collected evidence without credentials or network calls.         |
| Core / runner        | Validate policy, resolve built-in components and targets, deduplicate requests, bound concurrency, retry with rate-limit handling, and evaluate rules.                        |
| Reporter             | Consume the common scan report. Initially JSON and static Pages; adding formats must not change rules.                                                                        |
| Action adapter       | Read workflow inputs, call the common runner directly, and translate structured results into outputs, summary, and step success/failure. Keep Actions APIs out of the runner. |

Start with SDK, core, Action adapter, GitHub provider, GitHub rules, JSON reporter, and Pages reporter/dashboard packages. Avoid circular dependencies and unnecessary packages. Internal workspace packages do not imply npm publication. Do not introduce a CLI package, command parser, subprocess boundary, numeric exit-code contract, or npm CLI distribution. Focus the initial release on GitHub Actions. Keep the TypeScript source on the main development branch and generate compiled Action JavaScript in a separate release commit before tagging it. Maintain the Action and common runner in the same repository.

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

Use the PAT only for collection. Use GITHUB_TOKEN and OIDC for Pages deployment, separating scan and deployment permissions. Never publish secrets, raw API responses, or unnecessary source content. Escape untrusted rendered data.

Use fixture-based Vitest tests for rules, collection/evaluation failures, and reporters. Validate formatting, lint, types, tests, and relevant builds. Distinguish failed checks from unrun checks. Documentation-only examples cannot be claimed as tested against an implementation.

## Releases and distribution

The manual Prepare Action release workflow implements the following maintainer process. It has not been run to publish a real tag. Keep the Action and common scan runner in `ueokande/kypa`; the initial distribution is the root GitHub Action, without a standalone CLI or npm publication.

The main development branch (currently `master`) tracks TypeScript source, tests, build configuration, and root `action.yml`, but no generated JavaScript. Exact release tags such as the illustrative `v1.0.0` point to separate release commits retaining the selected source plus the compiled Action bundle and runtime assets. The release version identifies that bundle and its recorded source revision. The distinction remains if the main branch is renamed.

The planned GitHub Actions release workflow prepares artifacts before creating the public tag:

1. Select and record an exact source commit and release version. Use the repository's pinned toolchain and frozen pnpm lockfile once implementation begins.
2. Run formatting, lint, separate type checking, fixture-based tests, and relevant builds against that source. Build the Action and shared packages with Rslib and the dashboard with Rsbuild.
3. In an isolated temporary release branch or checkout, retain the selected source and add the compiled Action bundle and required assets. Verify that the root `action.yml` references an existing compiled entry point and that the bundled Action works without consumer dependency installation. Exercise the bundled Action end to end as well as running source-level checks.
4. Create a release commit containing those generated files. Record the original source SHA and version in release metadata so the generated commit can be traced back to reviewed source.
5. Create the exact tag, such as `v1.0.0`, on that release commit and push it. Record the source SHA, release-commit SHA, and validation results in the release notes.

The source commit and release commit have different SHAs. Creating the final tag is a release-workflow output: do not first tag the source commit and later move that same tag to add JavaScript. Generated files need not be merged back into the development branch. A GitHub Release attachment does not add files to the Git tree used by `uses`.

Verify the pushed tag and its compiled entry point before announcing availability. If publication fails, preserve existing exact tags and repair the failed step without silently moving a released tag. Detailed workflow implementation, runtime pins, and artifact paths will be chosen when the software is implemented.

Document published release tags and recommend reviewed full release-commit SHA pinning to consumers. Exact release tags are immutable; a moving `v1` alias is not part of the initial contract. Keep build, provenance, tagging, and publication instructions here; keep `docs/` focused on configuring and using the released Action. No release currently exists.

After merging reviewed source into master, maintainers can run Prepare Action release with an exact stable tag matching the root package version (for example v0.1.0). The read-only build job runs pnpm check and uploads compiled artifacts. A separate job with contents: write checks out the same source SHA, downloads artifacts from that run, prepares an annotated tag on a generated commit, and pushes only that tag. Source branches are not updated. The preparation script requires a detached checkout and rejects dirty source, mismatched versions, existing tags, missing artifacts, and symlink artifacts. It records source identity and SHA-256 artifact hashes in dist/provenance.json. Update package versions before dispatching a different release version. The workflow currently accepts dispatches from master only. Preparing a tag does not create a GitHub Release announcement or change Pages visibility. Do not execute publication as part of ordinary development verification.
