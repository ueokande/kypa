# Troubleshooting

> Troubleshooting guidance for the proposed first release. Kypa itself is not implemented; unavailable packages, commands, and Action tags today are expected, not installation defects.

| Symptom | Checks and next action |
| --- | --- |
| Action entry point is missing when using a branch or SHA | Use an actual published release tag or its release-commit SHA. The main development branch contains TypeScript without generated JS; a source SHA or GitHub Release asset is not a substitute for a compiled Action commit. |
| CLI and Action versions differ | Match npm version `1.0.0` with Action tag `v1.0.0` once released, and check the recorded source revision. The Action uses its bundled CLI rather than a locally installed npm CLI. |
| Authentication fails | Check PAT expiry, organization approval, allowed token policies, classic-token SSO authorization, and the central `KYCA_PAT` secret name. Confirm secure local `KYCA_GITHUB_TOKEN` injection without printing its value. Rotate through secure settings. |
| Some repositories are missing | Check the token's resource owner, selected repositories, account access, organization membership, fork/archive filters, exclusions, and discovery coverage. Compare against an independent inventory; inaccessible repositories may be invisible. |
| Files work but settings fail | Contents read does not imply Administration read or sufficient account privileges for protection endpoints. Check the selected rule's requirements. |
| GitHub returns 404 | Distinguish absent data from unauthorized access. Verify identity and endpoint permissions independently; do not turn every 404 into “no protection” or a passing result. |
| Rate limits or timeouts | Inspect safe retry guidance, lower concurrency, and honor `Retry-After`. Bounded retries cannot overcome permanent permission failures or unlimited quota demand. |
| Empty effective targets | Confirm at least one organization/repository and review archive/fork filtering and exclusions, including explicit targets. An empty effective set is fatal. |
| Unknown rule or plugin | Confirm installation, explicit registration, exact IDs, and enabled rule selection. Build local TypeScript into ESM first. Check SDK apiVersion compatibility and duplicate IDs. |
| Exception does not apply | Check exact rule ID, repository pattern, unique ID, reason, and quoted calendar date. Expiry uses scan-start time and the end of the named UTC day. Excluded targets stay excluded; errors cannot be exempted. |
| Zero violations but partial report | Inspect discovery, collection, and evaluation errors and coverage. Zero findings does not prove evaluations succeeded. |
| Dashboard is stale | Compare displayed run time with Actions results. Fatal scans and failed deployments leave the previous deployment visible; a live site is not evidence of freshness. |
| Broken assets or missing artifact | Match Pages `basePath` to the actual URL and the workflow artifact path to the configured directory. Use dedicated nonoverlapping output paths and static-friendly routing. |
| Viewers cannot access Pages | Check enterprise Pages availability, Pages access restrictions, viewer authorization, build source, environment approvals, and deployment status. Do not make internal results public as a workaround. |
| Unexpected required-review failures | This rule checks classic default-branch protection only, not effective rulesets, bypasses, or enterprise enforcement. Ruleset-only protection can fail; select the check deliberately. |

## Safe diagnosis

Start with local validation and the rule list, then examine safe stderr logs, run identity, coverage, and workflow job status. Local validation does not test GitHub access. Determine whether failure is local configuration, global authentication, an individual target operation, or report output before retrying.

Never dump the process environment, authorization headers, PATs, raw API responses, or internal source files into logs or public issues. Redact repository names, source paths, user identities, organization details, and sensitive findings as needed. Share a minimal sanitized policy, tool/rule versions, safe error text, and reproducible fixture rather than credentials or private payloads.

Do not add blanket `continue-on-error`, suppress errors with exceptions, or publish partially written files to get a green deployment. Use `fail-on: never` for publishing generated violation/partial reports while preserving fatal failures. See [CLI exits](cli.md), [authentication](authentication.md), and [publication](github-action.md).
