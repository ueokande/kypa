# Getting started

> Planned first-release workflow. Kypa and `@kypa/cli` are not implemented or published; the commands below cannot be used today.

## Prepare central execution

Create an internal execution repository in your GitHub Enterprise Cloud organization to hold the central policy, trusted plugins, and Actions workflow. Targets need no Kypa workflow or settings changes. Confirm that Actions and privately published Pages are available under your enterprise plan and organization policy. Configure Pages access before publishing sensitive results.

You need a PAT with existing access to all intended repositories and the permissions required by selected rules. Organization approval or SSO authorization may be required. Follow [authentication](authentication.md) before scanning. For local development, use a supported Node.js LTS and pnpm; compatible supported versions will be chosen when implementation begins.

## Install the proposed CLI

Once a release exists, replace `<released-version>` with an actual reviewed release. In your central repository:

```sh
pnpm init
pnpm add -D @kypa/cli@<released-version>
```

Run `pnpm init` only if no package manifest exists. Commit the resulting package manifest and `pnpm-lock.yaml` for repeatable installation. The placeholder is not an available package version. The released npm package will contain compiled JavaScript; consumers do not build Kypa from TypeScript. For example, a future `@kypa/cli@1.0.0` will correspond to the Action release tag `v1.0.0` from the same source revision. See [Releases and distribution](releases.md).

Create `kypa.yaml`:

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
  - name: pages
    options:
      directory: site
      basePath: /
```

The [configuration reference](configuration.md) explains defaults, exceptions, and target filtering. Arrange for your shell's secure environment injection or secret manager to provide `KYCA_GITHUB_TOKEN`. Do not paste literal tokens into commands, policy files, source code, or logs. The `KYCA_` spelling is intentional in this proposed contract. Kypa will not automatically load `.env` files.

## Validate and scan

After implementation and release, run:

```sh
pnpm exec kypa validate --config kypa.yaml
pnpm exec kypa rules list --config kypa.yaml
pnpm exec kypa scan --config kypa.yaml --fail-on never
```

Validation loads trusted plugins and checks local configuration without GitHub requests; it does not prove remote access. Scanning discovers targets, collects evidence, evaluates selected rules, applies exceptions, and writes `report/report.json` and `site/`. Inspect [coverage and errors](results.md) even when the command exits zero.

Keep generated output out of Git. Add these entries to your central repository's `.gitignore`:

```gitignore
/report/
/site/
```

For an internal local preview with Python 3 available:

```sh
python3 -m http.server 8000 --bind 127.0.0.1 --directory site
```

Open the local server in your own browser. This example uses `basePath: /`; a project Pages path requires the appropriate mount path when previewing. Do not expose sensitive output through a public preview or commit generated reports.

## Automate

Use the complete [GitHub Actions workflow](github-action.md) for daily and manual scans. Store the PAT as the central repository's `KYCA_PAT` Actions secret. Configure Pages with GitHub Actions as its build source and enforce restricted visibility before the first deployment. The PAT is for collection; deployment uses GITHUB_TOKEN/OIDC separately.

Use the Action release tag or its reviewed full release-commit SHA, rather than `master` or the source commit SHA. The tagged release commit includes compiled Action JavaScript; the development branch does not. Built-in Action use needs no pnpm installation or Kypa compilation in your workflow.
