# GitHub Action and private Pages

> Proposed first-release Action contract. `ueokande/Kypa@v1.0.0` below is a future illustrative reference, not an existing release. The workflow cannot run Kypa today.

The root Action in `ueokande/Kypa` wraps the CLI. The released Action bundles the compiled CLI, built-in components, and their runtime dependencies; built-in checks do not require pnpm, a consumer-side build, or an npm download of the CLI in the workflow. Install and build custom plugins from the trusted central repository before invoking the Action; never fetch executable plugins from scanned targets.

## Relationship to the CLI and release tags

The CLI and Action are maintained in the same `ueokande/Kypa` repository and share the same scanning implementation. The CLI owns orchestration; the Action is a thin adapter that maps inputs to CLI configuration, supplies the collection token through the process environment, reflects failure semantics, and writes Action outputs and the aggregate job summary. Rules and collection logic are not duplicated in the Action. The Action may call the shared CLI execution entry point directly; a subprocess is not required.

The main development branch (currently `master`) contains TypeScript source and does not track generated JavaScript. A release tag such as the future `v1.0.0` points to a separate release commit containing both that source and compiled Action JavaScript. The root `action.yml` must reference an entry point present in that tagged commit. A GitHub Release asset alone is insufficient for a JavaScript Action invoked with `uses`.

Use a published release tag or, preferably, its reviewed full release-commit SHA. `uses: ueokande/Kypa@master` is not a supported execution path because the development branch lacks the compiled entry point. A source commit SHA is also not interchangeable with the corresponding release-commit SHA. Exact version tags are immutable; a moving `v1` alias is not part of the initial documented contract. See [Releases and distribution](releases.md) for build provenance and npm version correspondence.

## Inputs and outputs

| Input | Required | Default |
| --- | --- | --- |
| `token` | Yes | None; pass the central `KYPA_PAT` secret. |
| `config` | No | `kypa.yaml` |
| `fail-on` | No | `never`; same policies as the CLI. |

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
      # Install and build trusted central plugins here if configured.
      - name: Scan policies
        id: kypa
        uses: ueokande/Kypa@v1.0.0
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

`fail-on: never` allows violations and partial reports to be generated, uploaded, and deployed, keeping visible information current. A partial report must clearly state missing coverage. Fatal configuration, authentication, plugin, or reporter errors fail the scan job and prevent deployment through `needs: scan`. Do not add blanket `continue-on-error` or unconditional upload/deploy steps that mask fatal failures.

A fatal scan or failed deployment leaves the previous Pages result in place. Its age remains significant: check the displayed scan timestamp and workflow result, not merely whether the site loads. Concurrency serializes runs without canceling an active scan. The initial release stores only the latest published scan and provides no history, diff, or trend view.
