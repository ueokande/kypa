# Built-in rules

> Proposed first-release behavior. No rules are implemented yet. Only rules selected in central configuration run.

## `actions/full-sha`

| Property | Contract |
| --- | --- |
| Version | Rule version will be recorded in reports; released version not assigned yet. |
| Resource type | `github/repository` |
| Default severity | `high` |
| Parameters | None |
| Required access | Contents read for default-branch files. |

Require remote GitHub Action and reusable workflow references to use a 40-character hexadecimal commit SHA. Inspect workflow step `uses`, job-level reusable workflow `uses`, and `uses` inside composite `action.yml` or `action.yaml` files in the scanned repository. For example:

```yaml
steps:
  # Illustrative syntax only: replace with a reviewed existing commit.
  - uses: example-owner/example-action@0123456789abcdef0123456789abcdef01234567
```

Tags such as `@v1` and branch names such as `@main` fail this textual policy. Local `./` references are distinguished from remote `owner/repository@ref` references. An explicit remote reference back to the same repository is still remote and requires a SHA; a local path does not. Docker references (`docker://...`) are outside this check. No relevant remote references yields `not-applicable` rather than a claimed pass.

The rule does not recursively fetch remote actions or inspect their transitive dependencies. A valid SHA string guarantees neither existence nor safety, provenance, review, or immutability of external artifacts. Parse failures and unsupported reference forms must be reported as errors rather than silently passing. Findings identify path and line and link to the scanned commit.

Central policy ignores target suppression comments. Workflow lockfiles do not constitute an exception to a textual full-SHA requirement. Define authorized temporary exceptions centrally in [configuration](configuration.md).

## `repository/required-reviews`

| Property | Contract |
| --- | --- |
| Resource type | `github/repository` |
| Default severity | `medium` |
| Parameter | `minimum`: integer from 1 through 6, default `1`. |
| Evidence | Classic protection on the default branch, observed through GitHub API. |
| Required access | Administration read for fine-grained PATs and sufficient account privileges; classic PAT scope and endpoint access must also be sufficient. |

```yaml
rules:
  repository/required-reviews:
    parameters:
      minimum: 2
```

Evaluate whether established classic default-branch protection requires at least `minimum` approving reviews. An empty repository without a default branch is `not-applicable`. Confirmed protection below the minimum, or confirmed absence of classic protection with established access, fails. Ambiguous access is an error; a 404 alone does not prove absence of protection.

This rule does **not** calculate effective rulesets, bypass permissions, enterprise enforcement, or the complete security posture of branch changes. A repository protected only by rulesets can fail this classic-protection check even if its effective review requirements are strong. Select this rule only when this scope matches your organizational policy; do not enable it universally by default. See [authentication](authentication.md) for the distinction between token permission and account privilege.
