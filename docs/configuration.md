# Configuration reference

> Proposed first-release YAML contract. No parser or runtime is available yet.

Use `kypa.yaml` by default or select another file with `--config`. All local paths, including plugin and output paths, resolve relative to the policy file, not the shell's working directory. Unknown keys and duplicate YAML keys are rejected.

## Complete example

```yaml
version: 1

plugins:
  - ./plugins/company/dist/index.js

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

exceptions:
  - id: legacy-build-migration
    rule: actions/full-sha
    repositories:
      - example-org/legacy-build
    reason: Temporary exception until migration is complete
    expires: '2027-03-31'

reporters:
  - name: json
    options:
      path: report/report.json
  - name: pages
    options:
      directory: site
      basePath: /kypa-monitor/
```

This example spans two owners. Confirm that the selected authentication covers both; a fine-grained PAT does not automatically do so. It also intentionally excludes `legacy-*`: the displayed exception does not bring `legacy-build` back into scope. Remove or narrow that exclusion if you intend to scan that repository and exempt its findings.

## Top-level fields

| Field | Contract |
| --- | --- |
| `version` | Required policy format version, initially `1`. |
| `plugins` | Optional explicit trusted package specifiers or compiled local ESM paths. No target-provided code loading. |
| `targets` | At least one organization or explicit repository is required. |
| `scan` | Optional collection controls; defaults below. |
| `rules` | Selected registered rule IDs with settings. At least one enabled rule is required. |
| `exceptions` | Optional centrally approved, expiring finding exceptions. |
| `reporters` | Required nonempty list of registered reporters and validated options. |

## Targets

`organizations` lists organization names for paginated enumeration. `repositories` lists exact `owner/name` identities. Take the union, deduplicate case-insensitively, then apply archive/fork filters and exclusions. Explicit repositories are subject to the same filters. `includeArchived` and `includeForks` both default to `false`. Exclusions take precedence over all inclusions and exceptions. An empty effective target set is fatal.

Repository matching is case-insensitive. Initial exclusion and exception patterns support only `*`, which matches within one owner or repository name component and never crosses `/`. For example, `example-org/service-*` matches `example-org/service-api`; it does not match a nested path. Do not rely on `**`, `?`, character classes, or regular expressions.

Discovery cannot list repositories the token cannot see. Compare discovered scope with an independently maintained inventory when completeness matters. Explicit inaccessible targets must be reported as errors rather than silently treated as compliant.

## Collection controls

| Setting | Default | Meaning |
| --- | --- | --- |
| `scan.concurrency` | `4` | Positive integer cap on concurrent requests. |
| `scan.retries` | `3` | Nonnegative integer maximum retries after an initial request. |
| `scan.requestTimeoutSeconds` | `30` | Positive request timeout in seconds. |

Retries are bounded and honor `Retry-After` and rate-limit responses. Permanent authorization/configuration failures must not cause endless retries. Lower concurrency when rate limits occur; higher concurrency does not increase API quotas.

## Rule selection

Only rules listed in `rules` with `enabled` other than `false` run. `enabled` defaults to `true`; severity defaults to the rule's declared default. Allowed severities are `info`, `low`, `medium`, `high`, and `critical`. `parameters` are validated using the rule's runtime schema, including defaults and constraints. Unknown rule IDs, invalid parameters, unknown settings, and configurations with no enabled rules are validation errors. Installing a plugin does not automatically enable its rules.

## Exceptions

Each exception requires a unique `id`, an exact registered `rule` ID, a nonempty `repositories` pattern list, a nonblank `reason`, and a valid quoted UTC calendar date in `expires` (`YYYY-MM-DD`). Wildcards apply to repository patterns, not rule IDs.

An exception is valid through the entire specified UTC day and expires at the next day's 00:00 UTC. For `expires: '2027-03-31'`, expiry is `2027-04-01T00:00:00Z`. Evaluate all exceptions against the scan-start timestamp so a long scan does not change eligibility halfway through.

Retain original findings and all matching exception metadata. Expired exceptions produce warnings and do not suppress findings. Exceptions cannot suppress discovery, collection, or evaluation errors, override central rule selection, or re-include excluded targets. When only some findings are exempt, the evaluation still fails. Target repository settings and suppression comments cannot override this policy.

## Reporters and plugins

`json` requires `options.path`, the destination JSON file. `pages` requires `options.directory` and `options.basePath`. A base path must start and end with `/`: use `/` at a root or `/kypa-monitor/` for that project path. It must match the deployment URL.

Output destinations must not overlap each other or overwrite source, configuration, or plugins. For example, do not put the JSON file inside the Pages destination, point Pages at the policy directory, or use a source file as an output path. Use dedicated generated directories and ignore them in Git.

Register plugins from trusted installed packages or local compiled ESM such as `./plugins/company/dist/index.js`. Compile TypeScript before loading it. Plugin compatibility, IDs, and reporter options are validated locally; duplicate IDs and incompatible SDK versions are rejected. See [plugins](plugins.md).
