# GitHub Action and private Pages

> Proposed first-release Action contract. `ueokande/kypa@v1.0.0` below is a future illustrative reference, not an existing release. The workflow cannot run Kypa today.

The initial supported entry point is the root GitHub Action in `ueokande/kypa`. The released Action bundles the scan runner, built-in components, and runtime dependencies. Consumers do not need pnpm, a consumer-side build, or an npm installation.

## Choose an Action reference

Once a release exists, use its published version tag, such as the illustrative `ueokande/kypa@v1.0.0`, or preferably pin its reviewed full release-commit SHA. Review the release notes and recorded source provenance when selecting a version.

The development branch (`master`) does not contain compiled Action JavaScript and is not a supported runnable reference. Use the release commit rather than its underlying source commit. Exact version tags remain fixed; a moving `v1` alias is not part of the initial documented contract.

## Inputs and outputs

| Input     | Required | Default                                   |
| --------- | -------- | ----------------------------------------- |
| `token`   | Yes      | None; pass the central `KYPA_PAT` secret. |
| `config`  | No       | `kypa.yaml`                               |
| `fail-on` | No       | `never`; failure policies below.          |

After successful report generation, proposed outputs are:

| Output            | Meaning                                             |
| ----------------- | --------------------------------------------------- |
| `run-id`          | Identity of this scan.                              |
| `status`          | `complete` or `partial`, independent of compliance. |
| `violation-count` | Number of findings.                                 |
| `error-count`     | Discovery, collection, and evaluation errors.       |

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
    - cron: "17 0 * * *"
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

| Value       | Behavior                                                                                     |
| ----------- | -------------------------------------------------------------------------------------------- |
| `never`     | Succeed after report generation, including violations and partial coverage.                  |
| `violation` | Fail for any finding or discovery, collection, or evaluation error.                          |
| `error`     | Fail for discovery, collection, or evaluation errors; violations alone do not fail the step. |

The runner returns structured outcomes rather than CLI exit codes. The Action marks the step as failed when a generated report triggers the selected failure policy or a fatal configuration, authentication, or output error occurs. Fatal failures always fail the Action regardless of `fail-on`.

Globally unusable authentication is fatal; isolated target access failures can yield a partial report. A reporter failure is fatal even if another reporter already wrote files. Generated files from a fatal run must not be deployed. Configuration validation checks rule IDs, parameters, and reporter options before collection; it does not prove remote access. Logs go to stderr and structured results go through the configured reporters.
