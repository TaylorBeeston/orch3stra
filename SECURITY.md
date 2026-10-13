# Security and privacy

This editor is a trusted-device, single-user local application, not a multi-tenant public service. Bind to loopback by default. For network access review pairing, allowed Host/Origin, explicit public origin, transport encryption and network ACLs. Keep the native worker private. Pairing passwords, session cookies and worker tokens are secrets; never include them in URLs, logs or reports. Remembered WanGP/HF credentials are plaintext in private data files; planner API keys stay in memory/environment.

Project JSON and references are untrusted input. Preserve validation, path ownership, immutable media, CAS revisions, CSRF checks and conservative media response headers. HTML/SVG and unknown blob types are downloaded with sandbox CSP/nosniff; header tests use benign content and do not prove exploit resistance. Existing image acknowledgements are scoped to selected preset and reported model/license revision; unknown revisions remain unknown.

Lost submissions must reconcile their recorded request ID before another request. Queue restart pauses queued work and marks in-flight work interrupted; do not auto-replay inference. Backup cancellation must not erase original data. Browser storage is origin-scoped and is not automatically moved by server migration.

For a suspected issue, report privately to the maintainer through an agreed channel before publication. A public reporting address and support policy are not configured yet. Provide synthetic reproduction steps, version and redacted evidence; do not attach secrets, private project content or harmful payloads.
