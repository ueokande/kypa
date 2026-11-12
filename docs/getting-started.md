# Getting started

> Unreleased first-release workflow. Kypa has an initial source implementation, but the illustrative Action release references below are not available yet.

## Prepare central execution

Create an internal execution repository in your GitHub Enterprise Cloud organization to hold the central policy and Actions workflow. Targets need no Kypa workflow or settings changes. Confirm that Actions is available and choose an access-controlled static host for the HTML dashboard. The example workflow uses private GitHub Pages, but it is not required by the reporter.

The primary distributed entry point is the root GitHub Action in `ueokande/kypa`. No CLI is distributed through npm. You do not need a package manifest, pnpm, a local Kypa installation, or a consumer-side build to use the released Action.

## Configure authentication and hosting

Create a PAT with existing access to the intended repositories and the permissions required by selected rules. Organization approval or SSO authorization may be required. Follow [authentication](authentication.md) and store the PAT securely as the central repository's `KYPA_PAT` Actions secret. Never place literal tokens in commands, policy files, workflows, or source.

Configure access restrictions on the chosen static host before deployment. If using GitHub Pages, set its build source to GitHub Actions and explicitly configure restricted Pages visibility. Internal repository visibility alone does not make Pages private. Verify the intended viewer restrictions before publishing sensitive results. Collection uses the PAT; Pages deployment uses GITHUB_TOKEN/OIDC separately.

## Create the policy

Commit `kypa.yaml` in the central repository:

```yaml
version: 1
targets:
  organizations:
    - example-org
rules:
  actions/full-sha:
    severity: high
reporters:
  - name: json
    options:
      path: report/report.json
  - name: html
    options:
      directory: site
      basePath: /
```

Replace `example-org` with your organization. This example uses `basePath: /`; for a project site, use the actual deployment path, such as `/kypa-monitor/`. See [configuration](configuration.md) for target selection, parameters, severity, and output paths.

## Add the workflow and run it

Copy the complete [GitHub Actions workflow](github-action.md) into `.github/workflows/kypa.yaml`. Once a release exists, select its tag or reviewed full release-commit SHA. The tagged commit contains compiled Action JavaScript; the development branch and its source commit SHA are not supported runnable Action references.

Commit the policy and workflow to the central repository's default branch. Trigger `workflow_dispatch` from the Actions UI. The Action validates configuration, discovers targets, collects evidence, evaluates selected rules, and writes `report/report.json` and `site/` on the runner. Validation does not establish remote access; collection must succeed separately.

The example workflow uploads `site/` and deploys it to GitHub Pages. For another static host, replace those deployment steps and publish the complete directory with the same access restrictions. JSON remains a runner output unless you separately retain it using access-controlled storage or an appropriately restricted artifact. Do not expose reports through public artifacts or commit generated output. If generated directories are ever copied into the central checkout, ignore them in Git:

```gitignore
/report/
/site/
```

## Inspect the result and keep it current

Check the Action's job summary, scan outputs, deployment status, and dashboard timestamp. Inspect [coverage and errors](results.md) even when the workflow succeeds: `fail-on: never` allows violations and partial reports to publish. Fatal failures prevent deployment and leave the previous result visible.

The example schedule requests daily scans at 00:17 UTC / 09:17 JST, with best-effort scheduling on the default branch. Monitor workflow failures and PAT expiry so stale results are not mistaken for a current scan. See the [Action guide](github-action.md) for release-ref selection.
