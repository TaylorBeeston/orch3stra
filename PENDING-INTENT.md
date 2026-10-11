# Bridge-owned render intentions

The authenticated bridge owns `render-intents.json`. One bridge coordinator per
studio data directory serializes prepare, cancellation and dispatch reservation.
Client storage is not authoritative. No prompts, media or credentials are stored in
this ledger. Distinct browser owners cannot overwrite each other's records.

A request ID is allocated before confirmation/uploads. Managed Regenerate captures
its final managed mode immediately and receives a pre-owned `seq_*` ID. Native and
managed lookup paths are separate. The bridge checks scope, current lease, state and
project fence inside the same serialized transaction that marks dispatch attempted.
If Cancel wins, dispatch sends nothing. If reservation wins, Cancel reports that the
request may have been sent; it cannot falsely promise to stop a worker job.

UI reload supersedes that owner's prepared lease. Bridge restart cancels prepared
records but retains attempted/uncertain IDs. Inline Regenerate Close invalidates the
exact prepared intention, including delayed CPU prefix completion. Pagehide invalidates
the local callback immediately and requests cancellation; an unavailable browser cannot
claim that its remote cancellation succeeded. Nothing automatically retries generation.

Pending requests uses `/api/render-intent` with normal bridge authentication:
- `begin-session`: owner and UI run ID; repeating that same session request is safe.
- `prepare`: owner, lease, project ID, final mode and captured destination.
- `list`, `get`: read records.
- `cancel`: prepared-only cancellation; attempted work requires reconciliation.
- `reconcile`: exact native request ID or pre-owned managed sequence ID. No match
  during a possible in-flight request remains uncertain and never authorizes replay.
- `invalidate-project`: explicitly fences a known dedicated project ID and records
  the reason. It preserves its records, footage, worker credentials and queue. This
  is not cancellation of an accepted worker job and does not delete project storage.

Old browser video/managed submissions lacking bridge-owned intentions are rejected.
WanGP worker wire formats and worker credentials are unchanged. The owned finishing,
reference, voice, music and speech-repair services retain their existing request protocols.
No arbitrary direct-client or multi-coordinator deployment guarantee is implied.
