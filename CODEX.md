# Codex subscription sign-in and model selection — 1.5.0

Open Connections → Codex subscription sign-in. Check the configured executable and CLI
version. Sign in with ChatGPT starts official account/login/start using chatgptDeviceCode.
Open the official URL and enter its temporary code from your phone or desktop. Codex owns
OAuth persistence. Director does not read OAuth token files, ask for your ChatGPT password,
or fall back to OPENAI_API_KEY. Cancel pending sign-in explicitly when necessary.

The dedicated Codex picker refreshes the signed-in app-server model catalog whenever it
opens and offers a manual **Refresh live model catalog** action. It requests every
`model/list` page with `includeHidden:true`, retains input modalities and reasoning efforts,
and never inserts model IDs into the returned list.

GPT-6 Sol and Luna were added to the Codex CLI catalog in **0.156.1** ([official release](https://github.com/openai/codex/releases/tag/rust-v0.156.1)). If the picker shows only older models, it reports a warning when the configured CLI is below that version. Update the exact CLI used by the Node service with its normal updater (`codex update` or its package manager), restart Director, then reopen the picker. `CODEX_BIN` can select a different executable. A newer CLI is necessary for these catalog entries, but account rollout/entitlement still determines availability; Director does not fabricate entries or grant access.

The release was tested against a local JSONL simulator, NOT an authenticated OpenAI account.

Read-only ephemeral planner threads retain no filesystem editing permissions. Tool requests
are rejected; prompts instruct JSON output only. Device-code sign-in has a bounded timeout,
validates the official verification URL, and exposes errors instead of presenting an empty
catalog as success. Endpoints require the same paired studio session, CSRF token and origin
checks as other account actions. The studio is single-user/equally trusted devices: signing
in changes the server Codex account, not a device-specific isolated tenant account.

Source: https://developers.openai.com/codex/app-server/
