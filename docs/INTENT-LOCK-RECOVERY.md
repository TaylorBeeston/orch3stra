# Render-intent writer lock: diagnosis and recovery

This candidate allows one cooperating bridge writer per data directory. Ownership is acquired before the default launcher starts/reuses a worker, before studio/pairing setup, and before any recovery manager starts. Explicit --check/--status/--setup/--stop commands retain their separate documented scope. A refused second instance must not alter existing runtime state. Normal orderly shutdown waits for manager work/writes before releasing ownership; normal process exit releases its own lock. CLI shutdown awaits the full manager barrier. Its four-second timeout forcibly terminates the process without exit cleanup, preserving the crash lock; this is not a confirmed graceful shutdown. SIGKILL, power loss, filesystem errors or an incomplete lock may leave a crash lock. Automatic lock takeover and request replay are deliberately absent.

The lock is `render-intents.json.writer-lock` beside the ledger. It contains PID, creation time and a random ownership nonce. Keep lock/ledger copies private. Never attach runtime files, leases, pairing/session data or credentials to a public bug report.

## Diagnose without changing state

1. Stop launching additional bridges and keep any existing worker queue paused if it already is. Do not change queue state merely to diagnose a lock.
2. Record the refusal, selected data directory, lock/ledger timestamps and private copies/hashes. Preserve relevant manager records and a consistent read-only queue snapshot. A previously copied empty ledger is not recovery authority.
3. Identify every bridge using that directory, including older versions, supervisors, other sessions, containers and hosts sharing storage. Inspect PID existence, command, working directory and start time using read-only process tools. A live PID, even if apparently reused or unrelated, does not authorize lock removal. An absent PID alone does not prove all writers are gone. Malformed locks or ambiguous process visibility require maintainer/owner investigation.
4. If the owner is live, leave its lock in place. Use that bridge or an explicitly isolated data directory. Do not signal, restart, pair or inspect credentials as part of this runbook without separate authorization.
5. If an existing authenticated context is available, compare the bridge's read-only intent list with preserved disk records and blocked entries. Do not use begin-session to inspect owners: it writes. If no authenticated context exists, record that gap without pairing anew.

## Manual stale-lock recovery, only after verified quiescence

This section describes a separately authorized recovery; it is not an automatic instruction executed by the application.

- Obtain owner authorization to stop/quiesce all bridges sharing the directory, including noncooperating older versions and restart supervisors. Do not stop the worker, cancel jobs or replay requests by implication.
- Verify that no writer remains or can restart, and preserve current lock, ledger, manager state and consistent queue evidence. If that cannot be established, leave the lock untouched.
- Reconcile each attempted/uncertain request against its exact native or managed ownership using read-only lookup. Preserve accepted records, owner entries, tombstones and budgets. Never infer permission to resubmit from a missing lookup, lost browser state or an empty old snapshot.
- Only when the lock is verified stale and the directory remains quiescent may an authorized maintainer move that exact lock into a private recovery-evidence location. Retain it rather than destroying evidence. Do not delete, replace or reset the ledger. No blind removal command is provided because it cannot establish quiescence.
- Start one reviewed cooperating bridge. Inspect its recovered state and continue explicit reconciliation. Prepared intents may become cancelled on legitimate restart; attempted/uncertain work is not automatically retried. Unexpected state requires stopping the recovery process and preserving evidence, not resetting files.

## Limits

The hash check is a pre-write consistency fence. It is not atomic compare-and-swap against a noncooperating writer: an older process could write between the check and rename. Older bridges must be excluded from the same directory. The exclusive-create lock requires local filesystem behavior; shared/network-filesystem semantics and crash-lock UX remain validation gates. Transparent browser/service/worker/checkpoint disaster restoration is not established by this runbook or the synthetic fixtures.
