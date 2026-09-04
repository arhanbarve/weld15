# Security Policy

## Reporting a vulnerability

Please report security issues privately rather than opening a public issue.

Use GitHub's [private vulnerability reporting](https://github.com/arhanbarve/weld15/security/advisories/new)
on this repository. That channel is monitored and keeps the report confidential
until a fix is available.

Please include what you found, how to reproduce it, and what an attacker could
do with it. You should get an initial response within a week.

## Scope

This is a static, client-only visualisation. It has no backend, no accounts, no
user data, and no database. The realistic issue classes are therefore narrow:

- **Exposure of the Google Maps API key.** The key is a `NEXT_PUBLIC_` browser
  key and is intentionally present in the client bundle — that is how Google's
  Map Tiles API is designed to work for browser clients. It is restricted by
  HTTP referrer and by API, and it carries a daily quota cap. Finding the key in
  the bundle is expected and is not a vulnerability. A way to use it from an
  origin the referrer restriction should have blocked *is* one.
- **Dependency vulnerabilities.** Dependabot is enabled; please still report
  anything you believe is being exploited in practice.
- **Cross-site scripting or content injection** via URL state. The app encodes
  scene state in the query string; a way to turn that into script execution
  would be a genuine finding.

## Not in scope

- The building geometry, dimensions, and imagery are drawn from public datasets
  and published sources, all credited in `docs/SOURCES.md` and `NOTICE`.
- Reports that amount to "the API key is visible in the JavaScript bundle"
  without demonstrating a bypass of the referrer or API restrictions.
