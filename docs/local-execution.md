# Local execution

Run the private `@kypa/cli` package from a source checkout to scan real GitHub repositories. It uses the same policy loader, runner, provider, rules, and reporters as the Action. It does not require Actions environment variables. There is no npm CLI distribution.

## Build

Use Node.js 24 LTS and the pnpm version pinned in the root `package.json`. From the repository root:

```sh
pnpm install --frozen-lockfile
pnpm build
pnpm cli --help
```

The build produces `dist/cli/index.js` and the dashboard assets. Rebuild after changing the source.

## Configure and run

Set `GH_TOKEN` in your shell using your preferred credential manager. The CLI falls back to `GITHUB_TOKEN` when `GH_TOKEN` is unset or blank. The token needs access to the target repositories and the selected evidence; see [authentication](authentication.md). Tokens are accepted only through the environment.

Create `kypa.yaml`, replacing the repository name with one you can access:

```yaml
version: 1
targets:
  repos: [your-org/your-repo]
rules:
  actions/full-sha: {}
reporters:
  - name: json
    options:
      path: report/report.json
  - name: html
    options:
      directory: site
      basePath: /
```

Run from the checkout root:

```sh
pnpm cli --config ./kypa.yaml
```

`--config` (short form `-c`) resolves relative to the current working directory and defaults to `kypa.yaml`. Reporter paths resolve relative to the policy file. Existing output destinations are rejected; choose fresh paths or remove only outputs you intentionally generated before running again. See [configuration](configuration.md) for other targets, rules, and collection settings.

The command prints scan status and counts to stdout and individual coverage errors, including HTTP status and remediation hints, to stderr. `partial` with zero resources means discovery did not produce scannable targets; zero findings in that case does not establish compliance. JSON and HTML files are written to the configured destinations, including when findings trigger a nonzero exit code. Serve the HTML directory through HTTP, for example:

```sh
python3 -m http.server 8000 --bind 127.0.0.1 --directory site
```

Open `http://localhost:8000/`.

## Failure policy

`--fail-on` accepts the same modes as the Action: `never` (default), `violation`, or `error`.

```sh
pnpm cli --config ./kypa.yaml --fail-on violation
```

| Exit code | Meaning                                                                                                                         |
| --------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `0`       | A report was generated and accepted by the selected failure policy. This can include findings or partial coverage with `never`. |
| `1`       | A report was generated and triggered the failure policy.                                                                        |
| `2`       | Arguments, authentication, configuration, or execution failed fatally. Do not publish this run.                                 |
| `130`     | The scan was cancelled with Ctrl+C. Do not publish this run.                                                                    |

Report generation is independent of the failure policy. Inspect report coverage and freshness as described in [results](results.md); exit code `0` alone does not establish compliance. The CLI does not publish reports or change target repository settings.

Configuration errors identify the invalid field and explain the expected format. For example, `reporters[1].options.basePath` refers to the second reporter (indices start at zero); use `/` for a site served from the host root, or `/report/` for a site served under that URL path. YAML syntax errors include line and column numbers. Diagnostics do not echo configuration values.
