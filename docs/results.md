# Results and coverage

> First-release report and dashboard contract. The source implementation uses the internal Report interface in packages/sdk; no Action release exists yet.

The static dashboard shows the latest published scan only. Controls include resource, rule, and severity filters and search. History storage, scan diffs, and trends are excluded initially. Display run freshness, scope, coverage gaps, and partial status prominently before interpreting compliance.

## Evaluations and findings

An evaluation records whether a rule could evaluate a resource and its outcome. A finding records a specific violation; it is not a substitute for an evaluation record. Zero findings does not establish successful evaluation.

| Evaluation status | Meaning                                                            |
| ----------------- | ------------------------------------------------------------------ |
| `pass`            | Evaluation completed with no violations.                           |
| `fail`            | Evaluation completed with at least one finding.                    |
| `not-applicable`  | The rule does not apply to available resource/evidence conditions. |
| `error`           | Required collection or evaluation could not complete reliably.     |

Keep all findings; do not delete evidence of violations. Errors cannot be converted into passes.

A `complete` report means the intended known scope was processed without scan errors; it does not mean compliant. A `partial` report has discovery, collection, or evaluation errors and must describe missing coverage even when violation count is zero. Inaccessible repositories may never appear in organization discovery, so completeness cannot prove access to the organization's entire inventory. Explicit targets and independent inventory reconciliation help reveal gaps.

File locations link to the resolved scanned commit. API evidence has its own collection time: settings can change during scanning, so a report is not an atomic Git/API snapshot.

## JSON report

The proposed JSON report uses `schemaVersion: 1` and these top-level fields:

| Field           | Intended content                                                                         |
| --------------- | ---------------------------------------------------------------------------------------- |
| `schemaVersion` | Report format version.                                                                   |
| `run`           | Run identity, timestamps, tool and policy versions, and complete/partial status.         |
| `scope`         | Requested/discovered/filtered scope and coverage information.                            |
| `resources`     | Generic identities and provider details, including resolved commits for repositories.    |
| `evaluations`   | Resource/rule outcomes, rule versions, and evidence availability/observation timestamps. |
| `findings`      | Stable finding identities, safe messages, severity, and locations.                       |
| `errors`        | Safe discovery, collection, and evaluation errors.                                       |
| `warnings`      | Nonfatal operational notices.                                                            |

Stable finding identity is intended to identify the same logical violation consistently; rule version and scanned commit remain recorded separately. The TypeScript Report interface in packages/sdk/src/index.ts defines the current field-level format. There is no separately published JSON Schema or supported external SDK.

Consumers must check supported schema versions, completeness, and evaluation outcomes before interpreting finding counts. Reports must not contain secrets, raw API payloads, or unnecessary source content. Messages and locations may still reveal internal repository names and policy posture; restrict report access.

## Pages output and freshness

The Pages reporter writes HTML, assets, and display data into its configured directory using `basePath` for deployed URLs. Routing must work on static hosting without a custom server or server-side API. Untrusted repository names, file paths, and messages must be escaped when rendered. Browser clients receive static data and never hold the collection PAT.

Violations and partial results can publish with the Action input `fail-on: never`. Fatal scan/output failures block publication even if files were partially written. A failed deployment preserves the previous result; always inspect the scan timestamp and workflow state. A loading site is not proof of a fresh successful scan. See [GitHub Action](github-action.md).
