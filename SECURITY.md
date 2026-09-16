# Security policy

## Supported versions

Security fixes are applied to the current `main` branch. Older snapshots and development branches do not have a separate security support commitment. Update to the latest `main` when checking whether a vulnerability still exists.

## Reporting a vulnerability

Email **peyman.iravani@gmail.com** with the subject **Falcon Automation security report**. This is the maintainer's public contact address. Do not open a public issue or pull request containing vulnerability details before coordination with the maintainer.

Include the affected commit or version, impact, prerequisites, and minimal reproduction steps or a proof of concept. Remove credentials, personal data, and third-party confidential information. Use only systems and data you are authorized to test.

The maintainer will review the report and coordinate fixes and disclosure with the reporter. No fixed response time is guaranteed. If you have not received a reply, follow up through the same email thread.

## Protecting local credentials

Keep `.env`, API keys, database credentials, and sensitive screenshots or reports out of commits and public issues. If a credential is exposed, revoke or rotate it with its provider. Use disposable test databases and accounts for reproduction.
