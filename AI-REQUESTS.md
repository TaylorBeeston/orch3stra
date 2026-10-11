# AI request troubleshooting — Director 1.2.1

This patch changes AI planning, not the WanGP renderer. The headless worker stays at
1.2.0 and the legacy plugin stays at 1.0.5. No GPU worker restart is required.

## What went wrong in 1.2.0

`direction-ui.js` called the browser provider function, which awaited a single
`POST /api/generate` until the whole model answer arrived. The bridge's generic
provider function used `fetch` followed by `response.text()` and a 12-minute
application abort timer. DeepSeek streaming was not enabled. Transport failures
were returned without structured cause information; there was no persistent
server-side AI event log. The browser trace was saved only after completion/error.

Those are demonstrated source-code limitations, not a diagnosis of the user's exact
failed request. We do not have its elapsed time, HTTP status or transport error.
The original story prompt already requested JSON: do not claim it lacked JSON
instructions, nor assume DeepSeek 4.1 is defective from a generic timeout.

## Using the fix

1. Back up the project and extract the new application to a fresh directory.
2. Stop only the old Director Node process; keep the detached WanGP worker running.
3. Start `node start-headless.mjs` in the new directory, with the same H3_DATA_DIR
   and any existing H3_VOICE_PYTHON or networking settings. It reuses worker 1.2.0.
4. Reload the same editor URL/browser profile. The footer reports bridge 1.2.1.
5. Build timeline → Let AI choose the runtime → Suggest natural runtime.
6. Watch the inline status/activity, or open **AI requests** in the top bar.

The main request is accepted quickly (HTTP 202). Small status reads replace the
one long browser connection. A request survives closing/hiding the dialog,
refreshing the browser, or a phone losing connectivity, while Node remains running.
No fake percent-complete or ETA is displayed: character counts are not token counts
and a network keep-alive is not evidence that the model has begun generating.

DeepSeek requests now use streamed deltas through a native Node HTTP(S) client,
with explicit connection/idle/total deadlines. Other providers use the same request
history/recovery infrastructure but keep their existing upstream protocols. They
may not supply live character counts, and their existing provider-specific limits
(such as the Codex 12-minute ceiling) still apply.

## Where the logs are

The launcher prints the path. With the default data directory:

```sh
tail -f "$HOME/.local/share/h3-director/ai-requests.log"
```

For a custom H3_DATA_DIR, the file is `$H3_DATA_DIR/ai-requests.log`.
The same metadata events appear prefixed `[AI]` in the Node terminal, or in:

```sh
journalctl --user -u h3-director -f
```

They are NOT in `headless/worker.log`: that is the renderer's log.

Events identify the request ID, kind, provider/model, phase, elapsed time, received
character count, HTTP status and error code. Terminal/event logs never include the
prompt, raw output or provider error body. The event log rotates at approximately
5 MiB into one `.1` backup.

In **AI requests**, select a request to see its event history, partial output,
finish reason/usage (when available), and exact captured prompt. **Download request
+ log** creates a diagnostic JSON suitable for troubleshooting. The full Diagnostic
report also includes the current project's captured server requests.

Private records are stored in `$H3_DATA_DIR/ai-requests/<id>.json`, with directory
permissions 0700 and file permissions 0600. They contain creative source text and
model replies. API keys, known server credentials and embedded media are omitted.
Review a report before sharing it: prompts, dialogue, names and reference descriptions
are still private content. No raw provider reasoning channel is retained/displayed.
The latest 100 finished server requests are retained; in-flight requests are not pruned.
This does not erase previously exported reports or traces in a browser/project backup.

## Interpreting failures

| Code/state | Meaning |
|---|---|
| AI_CONNECT_TIMEOUT | Could not establish the provider connection in 90 seconds. |
| AI_IDLE_TIMEOUT | No network data received for the configured idle interval. |
| AI_TOTAL_TIMEOUT | Director's entire request deadline elapsed, even if keep-alives continued. |
| AI_HTTP_401 / 402 / 429 / 5xx | The provider returned that HTTP status; inspect the safe captured error. |
| AI_STREAM_CLOSED / AI_STREAM_INCOMPLETE | Connection ended before a complete finish marker. |
| AI_OUTPUT_LIMIT | Provider explicitly stopped at its output ceiling. Partial JSON is not applied. |
| AI_EMPTY_OUTPUT | The response had no usable assistant text. |
| completed + invalid validation | Transport succeeded, but the story/prose still needs review. |
| interrupted | Node stopped/restarted; the operation is not automatically replayed. |

Partial output is diagnostic, not an automatically accepted plan. A failed request
cannot replace the current project. No automatic paid retry or model fallback occurs.
Cancel explicitly through the activity or request panel. Cancelling cannot guarantee
that a remote provider charges nothing for work it has already performed.

## Recovery without another charge

After refreshing, open **AI requests**. A completed pacing request has **Review pacing
response**. This reuses the saved response and makes no AI call. The source project,
brief, script, subject metadata and pacing options must still match; stale responses
are refused rather than silently overwriting changes. Review the beats normally and
use **Create editable project copy** to apply them. The original film stays intact.

Other kinds of AI requests retain inspectable output but do not yet have automatic
post-refresh import into their proposal editor. Download the response for recovery.
Previously failed 1.2.0 requests cannot be reconstructed by the new server logger.
Existing browser diagnostic traces may still contain their final error.

## Configuring deadlines

Defaults: 20 minutes total; 180 seconds without network data; 90 seconds to connect.
A DeepSeek keep-alive resets inactivity, but never resets the total deadline.
The total limit applies to every accepted server-tracked AI request; older upstream
provider-specific limits may be shorter. To change Director's limits explicitly:

```sh
env H3_AI_TIMEOUT_SECONDS=1800 H3_AI_IDLE_SECONDS=300 node start-headless.mjs
```

Valid total range: 30–3600 seconds. Valid idle range: 15–1800 seconds.
These settings do not alter the story's runtime, output-token budget, or GPU timeouts.
Increasing a timeout does not fix authentication, rate limits or provider overload.
DeepSeek documents a provider-side ten-minute wait limit when inference has not begun;
Director cannot override that. No new defaults claim to speed up model inference.

## Restart and service notes

Node restart interrupts active AI requests; it does not restart the detached GPU
worker. Completed AI records survive. An in-flight request is not silently resubmitted
because its remote usage may already have occurred. A Director-managed GPU sequence
may pause after its current window until you reconcile/resume it following Node restart.

For systemd users, the h3-director service's ExecStart must point to the new directory.
Regenerate the existing units using `node scripts/install-services.mjs --install`,
run `systemctl --user daemon-reload`, then restart **h3-director only**. Keep the
old release directory while a worker launched from it is running. The worker and
legacy plugin files in this patch are unchanged. Preserve your service environment
customizations if replacing unit files.

## Upstream sources checked 2026-09-14

- https://api-docs.deepseek.com/quick_start/rate_limit/ — empty-line/SSE keep-alives,
  including the provider-side wait limit before inference begins.
- https://api-docs.deepseek.com/api/create-chat-completion/ — streaming deltas,
  completion markers, usage and output-limit finish reasons. The parser accepts
  usage attached to the last content chunk and the older separate usage-only chunk.

Live DeepSeek inference and the target network were not tested; see VALIDATION-1.2.1.md.
