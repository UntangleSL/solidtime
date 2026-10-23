**Subject:** GitHub Actions jobs cancelled with "repository invocation blocked" on UntangleSL/solidtime

Hello,

Since 2026-10-23 (around 00:20 UTC), GitHub Actions no longer runs on our public repository **UntangleSL/solidtime** (a fork of solidtime-io/solidtime).

What we see:
- Workflow runs triggered by `push` on the branch `feature/m365-integration` are cancelled immediately. The job annotation says **"repository invocation blocked"** (for example, job "test (3, 8)" of the Playwright workflow).
- New pushes (commits `fff8dfe6`, `55faea65`) create no workflow runs at all.
- A manual `workflow_dispatch` of `fork-image.yml` returns: `HTTP 422: Actions has been disabled for this repository`.
- Yet the repository and organization settings show Actions as enabled ("Allow all actions"), and `GET /repos/UntangleSL/solidtime/actions/permissions` returns `{"enabled":true,"allowed_actions":"all"}`.

Context: this is our company's fork, used to develop a Microsoft 365 integration. On 2026-10-19 we enabled Actions on the fork and kept only the test/quality workflows (PHPUnit, PHPStan, Pint, npm checks, Playwright) plus one workflow that builds our Docker image to GHCR. We disabled the upstream build/publish workflows. On 2026-10-22/23 some Playwright shards hung for 40+ minutes at "Install Playwright Browsers" during a GitHub Actions incident, and we cancelled and re-ran them a few times. If this triggered an automatic restriction, we are happy to reduce our usage (for example, fewer Playwright shards).

Could you please review the repository and lift the block, or tell us what we need to change?

Repository: https://github.com/UntangleSL/solidtime
Organization: UntangleSL
Account: untangle-juan

Thank you,
Juan Herrero — Untangle
