# CLI reference

> Proposed first-release contract. The CLI and npm package are not published.

After a release, install `@kypa/cli@<released-version>` and invoke the local binary using `pnpm exec`. Examples below show the proposed binary directly.

```sh
kypa validate --config kypa.yaml
kypa rules list --config kypa.yaml
kypa scan --config kypa.yaml --fail-on never
```

| Option | Applies to | Default / meaning |
| --- | --- | --- |
| `--config <path>` | All commands | `kypa.yaml`; paths inside it resolve relative to that file. |
| `--fail-on never\|violation\|error` | `scan` only | `never`; selects exit policy after report generation. |
| `--help` | Command help | Show usage. |
| `--version` | CLI | Show installed tool version. |

## Commands

`validate` loads explicitly configured trusted plugins and checks policy format, rule IDs, runtime parameters, exceptions, and reporter configuration locally. It performs no GitHub calls and cannot establish remote access. Plugin loading executes trusted code, so review plugins even for validation.

`rules list` displays registered rule IDs, versions, resource types, required evidence, parameter information and defaults, and default severity. Registration is separate from policy selection.

`scan` discovers and filters targets, collects evidence, evaluates enabled rules, applies central exceptions, and invokes reporters. It resolves file evidence to the scanned commit. API settings are observed at collection time rather than atomically with that commit.

## Credentials and output

The only CLI credential source is `KYCA_GITHUB_TOKEN` in the process environment. There is no token argument and no automatic `.env` loading. Inject the value securely; never include literal tokens in a command or policy. Logs go to stderr. Structured output is written through configured reporters rather than mixed into logs.

## Exit codes

| Code | Meaning |
| --- | --- |
| `0` | Report generated successfully and selected failure policy did not trigger; or local command succeeded. |
| `1` | Report generated, but selected scan failure policy triggered. |
| `2` | Fatal usage, configuration, plugin, authentication, or output failure. |

| `--fail-on` | Behavior after report generation |
| --- | --- |
| `never` | Exit 0 even for violations or a partial report. |
| `violation` | Exit 1 for any non-exempt finding or any scan error. |
| `error` | Exit 1 for discovery, collection, or evaluation errors only. Violations alone exit 0. |

Fatal failures always exit 2, regardless of failure policy. System-wide unusable authentication is fatal; isolated target access/collection failures may instead yield a partial report with scan errors. A reporter failure is fatal even if another reporter already wrote files. Such files are not proof of successful publication and must not be deployed by a failed workflow. See [Action publication](github-action.md) and [result interpretation](results.md).
