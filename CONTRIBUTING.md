# Contributing to Falcon Automation

Thank you for helping improve Falcon Automation. Please follow our [Code of Conduct](CODE_OF_CONDUCT.md).

## Questions, bugs, and feature requests

Search [existing issues](https://github.com/eddieir/Falcon-Automation/issues) before opening a new one. Use the bug report or feature request template and include a small reproducible example where possible. For usage questions, open an issue with the command, expected result, and sanitized output.

Report vulnerabilities privately as described in [SECURITY.md](SECURITY.md). Never include API keys, database passwords, personal data, or unredacted environment files in public reports or test artifacts.

## Development setup

Use Node.js 24, matching CI, and npm. Fork and clone the repository, then create a topic branch from `New_era_Falcon`, the project's development branch:

```sh
git checkout New_era_Falcon
git pull --ff-only
git checkout -b fix/describe-your-change
npm ci
npx playwright install chromium
cp .env.example .env
```

Configure `.env` for the scenarios you need; see the [README](README.md). The OpenAI key is optional. Leave database settings unset unless using a test PostgreSQL instance. Do not commit `.env` or generated reports.

## Validation

Run the focused regression checks:

```sh
npm run test:unit
```

For browser, API, database, or runner changes, run the relevant scenarios in headless mode:

```sh
HEADLESS=true npm run test:ui
npm run test:api
npm run test:db
HEADLESS=true npm run test:e2e
HEADLESS=true node falcon.js --no-dashboard
```

UI and API scenarios use external demo services and require network access. Database tests need a disposable PostgreSQL database; `scripts/db/ci-seed.sql` supplies the CI fixture. Apply it only to a dedicated test database. Without database configuration, database scenarios skip; a skip does not validate database changes. The CI workflow documents the full environment and test sequence.

All applicable tests must pass in headless mode before opening a PR. Record the commands and results, including skipped checks and unavailable dependencies. Add regression coverage for changed behavior where appropriate.

## Pull requests

- Target `New_era_Falcon` for development changes, following the repository's existing contribution policy. Community-profile maintenance must also reach `main`, the default branch GitHub evaluates.
- Keep each PR focused and each commit a logical change. Explain why the change is needed.
- Update documentation for new capabilities or changed behavior.
- Follow the surrounding JavaScript style and avoid unrelated formatting changes.
- Complete the pull request template and link related issues.

Contributions are provided under the project's [MIT license](LICENSE).
