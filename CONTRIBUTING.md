# Contributing

Original app-owned source is MIT licensed. Contribute only material you have rights to submit under MIT; identify and preserve any third-party terms.

Use normal Git branches and pull requests against https://github.com/TaylorBeeston/orch3stra. Work with disposable data directories (`H3_DATA_DIR`), never your real project data. Preserve user media, project IDs, render snapshots and undo semantics. Do not make provider/model calls from tests.

Before opening a pull request, run `node scripts/check-all.mjs` (and `--integration` when you touch the UI and have Playwright/Chromium), plus `python3 -B scripts/check-ci.py`, which is what CI runs (see [docs/CI.md](docs/CI.md)). Report failures and skipped checks. New regression tests should exercise observable behavior and recovery rather than mirror the implementation.

Do not commit credentials, models, environments, private examples, generated footage, downloads or logs. Reference upstream dependencies by exact revision where known and keep attribution for copied material. Changes to the worker API, safety guards, media ownership or persisted schema need migration and rollback notes.
