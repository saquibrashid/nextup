# Security Policy

nextup is a single-owner, non-commercial project. It deliberately holds very
little that is sensitive, and is built to keep it that way.

## What nextup does and does not store

- **No streaming-service credentials, ever.** There is no login-as-you flow, no
  scraping, and no automated requests to any streaming service.
- **Screenshots** you upload are stored in a **private** blob container, served
  only through the authenticated API, and **auto-purged after 30 days**. No
  public URL and no SAS token is ever generated.
- Screenshot bytes are sent **only** to the two extraction endpoints (Azure
  OpenAI and Azure AI Vision) and nowhere else.
- The watchlist database uses managed-identity auth where possible; the fallback
  credential lives in Key Vault, never in the repo.
- **No telemetry, no analytics.** The dependency allow-list forbids such
  packages and CI fails if one is added.

See [specs/security.md](specs/security.md) for the full threat model, the
authorisation rules, secret handling, and logging prohibitions.

## Reporting a vulnerability

Please **do not** open a public issue for a security vulnerability.

- Use GitHub's **[private vulnerability reporting](https://docs.github.com/en/code-security/security-advisories/guidance-on-reporting-and-writing-information-about-vulnerabilities/privately-reporting-a-security-vulnerability)**
  ("Report a vulnerability" under the repository's **Security** tab), or
- Contact the repository owner directly through their GitHub profile.

Include: what you found, how to reproduce it, and the impact you believe it has.
Please do not include real credentials or another person's personal data in your
report.

## Response expectations

As a personal project maintained on a best-effort basis, aim points (not
guarantees):

- Acknowledgement within **7 days**.
- An assessment and a plan within **30 days** of acknowledgement.

## Supported versions

nextup is pre-alpha and unversioned. Only the current `main` branch is
supported; there are no back-ported fixes.

| Version | Supported |
|---|---|
| `main` (pre-alpha) | ✅ |
| Any tagged release | ❌ (none yet) |

## Handling secrets

If you believe a secret has been exposed, see the incident notes in
[specs/security.md](specs/security.md): rotate `TMDB_API_KEY` at TMDB, the
`ghcr.io` PAT at GitHub, and (only if the SQL-auth fallback is in use) the
database password in Key Vault. With managed-identity DB auth there is no
database password to rotate.
