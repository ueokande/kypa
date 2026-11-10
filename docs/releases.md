# Releases and distribution

> Planned first-release distribution contract. Kypa is not implemented or published. `v1.0.0`, `@kypa/cli@1.0.0`, and the layouts described here are illustrative future interfaces, not available artifacts.

## One repository, two entry points

Kypa's CLI and root GitHub Action are maintained together in [ueokande/kypa](https://github.com/ueokande/kypa). The CLI owns scan orchestration over shared core, providers, rules, and reporters. The Action is a thin wrapper around that CLI implementation: it translates workflow inputs, provides the token through the environment, reports outputs and a job summary, and preserves failure behavior. It does not duplicate checks or download the CLI from npm during a scan.

The shared CLI execution entry point should return results and an exit code so the Action can consume them. Process termination belongs at the outer executable boundary. Whether the Action calls that entry point in-process or invokes a bundled executable does not change the public inputs or scan semantics.

| Distribution | Intended contents | How users consume it |
| --- | --- | --- |
| Main development branch, currently `master` | TypeScript source, tests, build configuration, and root `action.yml`; generated JavaScript is not tracked. | Source development; not a supported runnable Action ref. |
| Exact release tag, for example `v1.0.0` | A release commit containing the selected source plus compiled Action JavaScript and required runtime assets. | `uses: ueokande/kypa@v1.0.0`, or preferably the reviewed full SHA of that release commit. |
| npm package, for example `@kypa/cli@1.0.0` | Compiled CLI and required runtime files, built from the same selected source revision. | Install an exact package version and commit the consumer's manifest and pnpm lockfile. |

The main branch name may change; the distinction between a source branch and a compiled release commit remains. The version prefix differs between channels: Action `v1.0.0` corresponds to npm `1.0.0`. Matching versions identify the same source revision, not identical package bytes or entry-point wrappers.

## How release commits are produced

The planned GitHub Actions release workflow prepares artifacts before creating the public tag:

1. Select and record an exact source commit and release version. Use the repository's pinned toolchain and frozen pnpm lockfile once implementation begins.
2. Run formatting, lint, separate type checking, fixture-based tests, and relevant builds against that source. Build CLI and shared packages with Rslib and the dashboard with Rsbuild.
3. In an isolated temporary release branch or checkout, retain the selected source and add the compiled Action bundle and required assets. Verify that the root `action.yml` references an existing compiled entry point and that the bundled Action works without consumer dependency installation. Test the packaged CLI as well as the source-level checks.
4. Create a release commit containing those generated files. Record the original source SHA and version in release metadata so the generated commit can be traced back to reviewed source.
5. Create the exact tag, such as `v1.0.0`, on that release commit and push it. Publish the npm CLI built from the same source and version, and record the release-commit SHA and distribution status in the release notes.

The source commit and release commit have different SHAs. Creating the final tag is a release-workflow output: do not first tag the source commit and later move that same tag to add JavaScript. Generated files need not be merged back into the development branch. A GitHub Release attachment does not add files to the Git tree used by `uses`.

Git tags and npm publication are separate operations and cannot be assumed atomic. If one channel fails, document which artifacts are available and repair the failed publication without rewriting an existing exact version tag or silently replacing published package contents. Do not claim a release is fully available until its intended channels have been verified. Detailed workflow implementation, runtime pins, and artifact paths will be chosen when the software is implemented.

## Select and verify a release

For production Actions, resolve a reviewed release tag to its full release-commit SHA and pin that SHA. Review both source changes and generated artifacts, and use recorded source provenance to understand what was built. A source commit from `master` does not contain the Action bundle and is not a runnable replacement for the release commit.

For local use, install a published exact CLI version as shown in [getting started](getting-started.md). The npm package is already compiled; a supported compatible Node.js runtime is still required. The released Action includes its CLI and runtime dependencies, so built-in checks do not need pnpm or an npm CLI download in the consumer workflow.

Exact release tags are intended to remain immutable. The initial documented interface does not promise a moving `v1` alias. All versions in this manual are examples until an actual release is announced. Release automation and distribution artifacts are not implemented by these documentation changes.
