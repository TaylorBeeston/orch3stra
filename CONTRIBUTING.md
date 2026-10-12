# Contributing

Original app-owned source is MIT licensed. Contribute only material you have rights to submit under MIT; identify and preserve any third-party terms. The source candidate is published at https://github.com/TaylorBeeston/orch3stra.

Read AGENTS.md. Work in isolated source and disposable data directories. Preserve user media, project IDs, render snapshots and undo semantics. Do not start provider/model calls as tests. Run the model-free check runner and relevant actual-browser fixtures with installed test tools; report failures and skipped checks. New regression tests should exercise observable behavior and uncertainty/recovery rather than mirror implementation.

Do not bundle credentials, models, environments, private examples, generated footage, downloads or logs. Reference upstream dependencies by exact revision where known; retain attribution for copied material. Changes to the worker API, safety guards, media ownership or persisted schema require migration and rollback notes. Release archives must be rebuilt and tested from their exact extracted bytes.
