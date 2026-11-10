# Authentication

> First-release authentication contract. Kypa has not been released yet.

Kypa reads repositories using a PAT passed to the proposed Action from a central `KYPA_PAT` Actions secret. The Action passes the token to the collection layer; users do not configure a separate token environment variable. Only collection receives credentials. Kypa does not automatically load `.env` files. Never put literal tokens in commands or policy files. Target repositories require no Kypa installation, but all normal access controls apply.

## Choose a token

Prefer a fine-grained PAT when organization policies and the required GitHub endpoints support it. Select the organization as resource owner and grant access to the intended repositories. A token's selected repositories constrain discovery and collection. Fine-grained PATs do not automatically span multiple resource owners: a multi-owner policy needs authentication that actually covers all targets. Check organization approval, token expiration, restrictions on token lifetimes, and other enterprise access policies before relying on scheduled execution.

A classic PAT is an alternative only when permitted by the organization. Private/internal repository access commonly requires its broad `repo` scope, increasing the exposure if compromised. Organizations using SAML SSO may require explicit SSO authorization. Token scopes never grant permissions that the issuing account does not already possess.

| Operation                                      | Required access to verify                                                                                                                                        |
| ---------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Organization discovery and repository identity | Existing account access and repository Metadata read; discovery only returns repositories visible to the token.                                                  |
| Default-branch files and Action references     | Contents read on each target.                                                                                                                                    |
| Classic default-branch protection              | Administration read for fine-grained tokens, endpoint support, and sufficient account privileges; classic tokens also need appropriate scope and account access. |
| Pages deployment                               | Separate GITHUB_TOKEN permissions and OIDC, not the collection PAT.                                                                                              |

Check current GitHub endpoint documentation when issuing a token: permission and organization policy requirements can change. Read access to files does not establish permission to inspect protection settings. A PAT cannot elevate its owner to administrator.

## Central Actions execution

Create `KYPA_PAT` in the central repository's Actions secrets and pass it to the Action's required `token` input. Ordinary GITHUB_TOKEN is scoped to its workflow repository and must not be assumed sufficient for reading other internal repositories. A GitHub App installation is not required by Kypa's initial workflow.

Keep collection permissions in the scan job and Pages write/OIDC permissions in the deployment job. The generated site must never contain the PAT, raw API payloads, or unnecessary source text. Browsers only receive static results; they never hold the PAT or call GitHub with it.

## Operate safely

Use the least access needed for selected rules. Rotate the PAT before expiry, update the central secret, and test a fresh scan. Revoke old credentials after the replacement works; respond promptly to suspected exposure. Ensure scheduled scans are monitored so an expired token does not leave an apparently current dashboard.

Safe errors should identify the operation and affected resource without printing authorization headers or tokens. A GitHub 404 can mean either an absent resource or insufficient access. Do not interpret every 404 as “no branch protection”; uncertain authorization is an error.
