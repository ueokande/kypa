# GitHub Action and private Pages

> Proposed first-release Action contract. `ueokande/kypa@v1.0.0` below is a future illustrative reference, not an existing release. The workflow cannot run Kypa today.

The initial supported entry point is GitHub Actions. The CLI is an internal execution layer and is not distributed through npm or documented as a standalone user interface.

The root Action in `ueokande/kypa` wraps the CLI. The released Action bundles the compiled CLI, built-in components, and their runtime dependencies; built-in checks do not require pnpm, a consumer-side build, or an npm download of the CLI in the workflow.

## Relationship to the CLI and release tags

The CLI and Action are maintained in the same `ueokande/kypa` repository and share the same scanning implementation. The CLI owns orchestration; the Action is a thin adapter that maps inputs to CLI configuration, supplies the collection token through the process environment, reflects failure semantics, and writes Action outputs and the aggregate job summary. Rules and collection logic are not duplicated in the Action. The Action may call the shared CLI execution entry point directly; a subprocess is not required.

The main development branch (currently `master`) contains TypeScript source and does not track generated JavaScript. A release tag such as the future `v1.0.0` points to a separate release commit containing both that source and compiled Action JavaScript. The root `action.yml` must reference an entry point present in that tagged commit. A GitHub Release asset alone is insufficient for a JavaScript Action invoked with `uses`.

Use a published release tag or, preferably, its reviewed full release-commit SHA. `uses: ueokande/kypa@master` is not a supported execution path because the development branch lacks the compiled entry point. A source commit SHA is also not interchangeable with the corresponding release-commit SHA. Exact version tags are immutable; a moving `v1` alias is not part of the initial documented contract. See [Releases and distribution](releases.md) for build provenance and release-ref selection.

## Inputs and outputs

| Input | Required | Default |
| --- | --- | --- |
| `token` | Yes | None; pass the central `KYPA_PAT` secret. |
| `config` | No | `kypa.yaml` |
| `fail-on` | No | `never`; failure policies below. |

After successful report generation, proposed outputs are:

| Output | Meaning |
| --- | --- |
| `run-id` | Identity of this scan. |
| `status` | `complete` or `partial`, independent of compliance. |
| `violation-count` | Number of non-exempt findings. |
| `error-count` | Discovery, collection, and evaluation errors. |

The Action also writes an aggregate job summary. Do not assume outputs exist after a fatal failure.

## Configure access before publishing

In the central execution repository, set Pages build source to **GitHub Actions** and explicitly configure private/access-controlled Pages visibility under your enterprise's supported settings. Verify access with an authorized viewer and an unauthorized viewer. Internal repository visibility alone is insufficient: Pages is not automatically private. Deployment does not configure visibility. Do not publish until the intended restriction is established.

Create the `KYPA_PAT` Actions secret as described in [authentication](authentication.md). Ensure its owner can read targets and selected settings endpoints. Use the PAT only in collection; deployment uses the workflow's GITHUB_TOKEN and OIDC.

## Complete illustrative workflow

All Action versions below, including third-party versions, are illustrative. Before use, verify current supported releases, permissions, and compatibility. In production pin reviewed full commit SHAs for every Action, including Kypa.

Save this workflow in the central repository's `.github/workflows/kypa.yaml` after the software is released:

```yaml
name: Kypa policy scan

on:
  schedule:
    - cron: '17 0 * * *'
  workflow_dispatch:

permissions: {}

concurrency:
  group: kypa-pages
  cancel-in-progress: false

jobs:
  scan:
    runs-on: ubuntu-latest
    permissions:
      contents: read
    steps:
      - uses: actions/checkout@v4
        with:
          persist-credentials: false
      - name: Scan policies
        id: kypa
        uses: ueokande/kypa@v1.0.0
        with:
          token: ${{ secrets.KYPA_PAT }}
          config: kypa.yaml
          fail-on: never
      - name: Upload generated site
        uses: actions/upload-pages-artifact@v3
        with:
          path: site

  deploy:
    needs: scan
    runs-on: ubuntu-latest
    permissions:
      pages: write
      id-token: write
    environment:
      name: github-pages
      url: ${{ steps.deployment.outputs.page_url }}
    steps:
      - name: Deploy Pages
        id: deployment
        uses: actions/deploy-pages@v4
```

The schedule requests 00:17 UTC / 09:17 JST daily. GitHub schedules are best effort, can be delayed, and run from the default branch. Keep the workflow and central policy on that branch. `workflow_dispatch` provides a manual run.

For a project site at `/kypa-monitor/`, set `reporters` Pages `basePath` to `/kypa-monitor/`; otherwise use the actual deployment path. The upload path `site` must match the policy's output directory relative to the workflow working directory.

## Publication behavior

`fail-on: never` allows violations and partial reports to be generated, uploaded, and deployed, keeping visible information current. A partial report must clearly state missing coverage. Fatal configuration, authentication, or reporter errors fail the scan job and prevent deployment through `needs: scan`. Do not add blanket `continue-on-error` or unconditional upload/deploy steps that mask fatal failures.

A fatal scan or failed deployment leaves the previous Pages result in place. Its age remains significant: check the displayed scan timestamp and workflow result, not merely whether the site loads. Concurrency serializes runs without canceling an active scan. The initial release stores only the latest published scan and provides no history, diff, or trend view.

## Failure policies and execution results

The `fail-on` input controls failure after report generation:

| Value | Behavior |
| --- | --- |
| `never` | Succeed after report generation, including violations and partial coverage. |
| `violation` | Fail for any non-exempt finding or discovery, collection, or evaluation error. |
| `error` | Fail for discovery, collection, or evaluation errors; violations alone do not fail the step. |

The internal runner distinguishes exit code `0` for success under the selected policy, `1` for a generated report that triggers that policy, and `2` for a fatal usage, configuration, authentication, or output failure. Fatal failures always fail the Action regardless of `fail-on`.

Globally unusable authentication is fatal; isolated target access failures can yield a partial report. A reporter failure is fatal even if another reporter already wrote files. Generated files from a fatal run must not be deployed. Configuration validation checks rule IDs, parameters, exceptions, and reporter options before collection; it does not prove remote access. Logs go to stderr and structured results go through the configured reporters.
