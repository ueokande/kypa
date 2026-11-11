# Configuration reference

> First-release YAML contract, implemented in the source tree but not released yet.

Use `kypa.yaml` by default or select another file with the Action's `config` input. All local paths, including output paths, resolve relative to the policy file, not the shell's working directory. Unknown keys and duplicate YAML keys are rejected.

## Complete example

```yaml
version: 1

targets:
  organizations:
    - example-org
  repositories:
    - another-org/special-service
  exclude:
    - example-org/legacy-*
  includeArchived: false
  includeForks: false

scan:
  concurrency: 4
  retries: 3
  requestTimeoutSeconds: 30

rules:
  actions/full-sha:
    enabled: true
    severity: high
  repository/required-reviews:
    severity: medium
    parameters:
      minimum: 2

reporters:
  - name: json
    options:
      path: report/report.json
  - name: html
    options:
      directory: site
      basePath: /kypa-monitor/
```

This example spans two owners. Confirm that the selected authentication covers both; a fine-grained PAT does not automatically do so. Repositories matching `example-org/legacy-*` are excluded from the scan.

## Top-level fields

| Field       | Contract                                                                           |
| ----------- | ---------------------------------------------------------------------------------- |
| `version`   | Required policy format version, initially `1`.                                     |
| `targets`   | At least one organization or explicit repository is required.                      |
| `scan`      | Optional collection controls; defaults below.                                      |
| `rules`     | Selected registered rule IDs with settings. At least one enabled rule is required. |
| `reporters` | Required nonempty list of registered reporters and validated options.              |

## Targets

`organizations` lists organization names for paginated enumeration. `repositories` lists exact `owner/name` identities. Take the union, deduplicate case-insensitively, then apply archive/fork filters and exclusions. Explicit repositories are subject to the same filters. `includeArchived` and `includeForks` both default to `false`. Exclusions take precedence over all inclusions. An empty effective target set is fatal.

Repository matching is case-insensitive. Initial exclusion patterns support only `*`, which matches within one owner or repository name component and never crosses `/`. For example, `example-org/service-*` matches `example-org/service-api`; it does not match a nested path. Do not rely on `**`, `?`, character classes, or regular expressions.

Discovery cannot list repositories the token cannot see. Compare discovered scope with an independently maintained inventory when completeness matters. Explicit inaccessible targets must be reported as errors rather than silently treated as compliant.

## Collection controls

| Setting                      | Default | Meaning                                                       |
| ---------------------------- | ------- | ------------------------------------------------------------- |
| `scan.concurrency`           | `4`     | Positive integer cap on concurrent requests.                  |
| `scan.retries`               | `3`     | Nonnegative integer maximum retries after an initial request. |
| `scan.requestTimeoutSeconds` | `30`    | Positive request timeout in seconds.                          |

Retries are bounded and honor `Retry-After` and rate-limit responses. Permanent authorization/configuration failures must not cause endless retries. Lower concurrency when rate limits occur; higher concurrency does not increase API quotas.

## Rule selection

Only rules listed in `rules` with `enabled` other than `false` run. `enabled` defaults to `true`; severity defaults to the rule's declared default. Allowed severities are `info`, `low`, `medium`, `high`, and `critical`. `parameters` are validated using the rule's runtime schema, including defaults and constraints. Unknown rule IDs, invalid parameters, unknown settings, and configurations with no enabled rules are validation errors.

## Reporters

`json` requires `options.path`, the destination JSON file. `html` requires `options.directory` and `options.basePath`. A base path must start and end with `/`: use `/` at a root or `/kypa-monitor/` for that project path. It must match the deployment URL.

Output destinations must not overlap each other or overwrite source or configuration. For example, do not put the JSON file inside the HTML destination, point HTML at the policy directory, or use a source file as an output path. Use dedicated generated directories and ignore them in Git.

Output destinations must be fresh, dedicated paths beneath the policy directory; existing destinations, including prior generated reports, are rejected rather than overwritten. The standard workflow checks out a fresh central repository on each run. Clear only known generated outputs before a development rerun. Symlinks must not redirect output outside the policy directory. HTML base paths support slash-delimited letters, digits, hyphens, and underscores.

Retries honor server delays up to five minutes; longer delays produce an explicit coverage error rather than holding a workflow indefinitely. A truncated Git tree, unsupported file mode, or Action/workflow file larger than 1 MiB produces a collection error. These limits must not be interpreted as a passing evaluation.

The `html` reporter produces a portable static site; it does not invoke any hosting API. Use the same directory with GitHub Pages, an internal HTTP server, or another access-controlled static host. Deployment and access restrictions are the hosting workflow's responsibility.
