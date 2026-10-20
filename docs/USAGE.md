# Using Orch3stra

A practical guide to the parts of the studio that are not covered by a dedicated feature guide. For setup see [FIRST-RUN.md](../FIRST-RUN.md); for individual tools see [EDITOR.md](../EDITOR.md), [POST.md](../POST.md), [SEQUENCES.md](../SEQUENCES.md) and [REFERENCES.md](../REFERENCES.md).

## Finding your way around

The editor has five work areas:

- **Overview**: project summary and the main steps.
- **Story**: brief, story/cast development, refinement and pacing.
- **References**: characters and files, Fill missing coverage, image/voice studios, scene reference planning and Clinic.
- **Timeline**: monitor, timeline, window selection, render controls and editing. **Window settings** holds timing, overlap, entry/exit state and direct references.
- **Post**: the finishing room, export and backups.

**Activity** collects the render, sequence, queue and AI-request monitors. **All tools / settings** (Ctrl/Cmd+K) is a searchable list of every tool. Switching areas, opening a tool or going Back never starts AI or GPU work.

Tool dialogs have a **Back** control and breadcrumb. Back returns to the parent tool with its form values, scroll position and selected window intact; Escape does the same, and × closes the whole stack. This is in-app navigation, not the browser's Back button, and it is not a substitute for saving: use Save/Apply before refreshing or closing the browser.

## Watching renders

**Render overview** (toolbar, or **Full live overview** for the expanded view) shows the whole server, not just the open project: renderer activity and queue pause, the current project/window/phase, observed denoising steps, saved windows, elapsed times, errors and timing adjustments. A managed film and its current window are shown as one entry.

The page refreshes about every two seconds while rendering and every eight seconds when idle, and immediately when you return to the tab. Mobile browsers may suspend background tabs; rendering never depends on the page being open. If the connection drops, the last data stays visible marked **stale/unavailable**. Refreshing is read-only: it never resumes, cancels or submits anything.

Remaining-time estimates appear after the first window of a managed film has been timed. They are ranges based on recent measurements, not deadlines, and they are hidden while a sequence is paused or the data is stale. Resolution, references, offloading and other GPU work all change the cost. The progress bar combines saved windows and observed steps; it is not a percentage of wall-clock time.

### Small frame-count differences

A finished window can come back a few frames shorter or longer than planned (for example 760 frames instead of 763 at 24 fps). For managed sequences, a difference of up to **four frames** is accepted when there is new footage: Orch3stra measures the real frame count, uses the measured end for playback, shifts later windows' start points by the difference and checks the saved prefix exactly before the next submission. Footage and audio are never padded, cut or re-encoded. Larger differences, a wrong frame rate, a missing output or a decode failure stop the sequence before another submission and keep the output for inspection.

To recover a completed window from an attempt that stopped, open **Sequences**, find the attempt (check History if hidden) and choose **Recover saved window…**. This creates a **new parked sequence** from the verified saved video; the original stays as it was. The recovered sequence uses the prompts and references from the original submission, not newer edits. Choose **Resume sequence** on the copy only when you want to generate the remaining windows. For a merely paused attempt, **Reconcile state** collects completed windows. Recovery cannot help if the native file was deleted or belongs to a different backend.

## AI planner requests

AI requests are accepted by the server and tracked there, so closing the dialog, refreshing the page or a phone losing its connection does not lose them while the Node editor keeps running. Watch them in the inline status or **AI requests**. No fake percentage or ETA is shown.

In **AI requests**, select a request to see its events, partial output, finish reason/usage (when the provider reports it) and the exact prompt. **Download request + log** saves a diagnostic JSON; review it before sharing, because it contains your prompts and story text (API keys and media are omitted).

Logs:

- `$H3_DATA_DIR/ai-requests.log` (default `~/.local/share/h3-director/ai-requests.log`), also printed as `[AI]` lines in the editor's terminal or `journalctl --user -u h3-director -f`. These contain metadata only, never prompts or model output, and rotate at about 5 MiB.
- Full private records: `$H3_DATA_DIR/ai-requests/<id>.json` (owner-only permissions). The latest 100 finished requests are kept.
- The renderer's own log is `headless/worker.log`; AI requests are not in it.

| Code / state | Meaning |
| --- | --- |
| `AI_CONNECT_TIMEOUT` | No connection to the provider within 90 seconds. |
| `AI_IDLE_TIMEOUT` | No data received for the idle interval. |
| `AI_TOTAL_TIMEOUT` | The overall request deadline passed. |
| `AI_HTTP_401` / `402` / `429` / `5xx` | The provider returned that HTTP status. |
| `AI_STREAM_CLOSED` / `AI_STREAM_INCOMPLETE` | The connection ended before the response finished. |
| `AI_OUTPUT_LIMIT` | The provider stopped at its output limit; partial JSON is not applied. |
| `AI_EMPTY_OUTPUT` | The response contained no usable text. |
| completed + invalid validation | The request worked, but the result still needs review. |
| interrupted | The editor stopped or restarted; the request is not replayed automatically. |

Partial output is never applied automatically, and there is no automatic paid retry or model fallback. Cancelling cannot guarantee the provider won't charge for work already done.

After a refresh, a completed pacing request offers **Review pacing response**, which reuses the saved answer without a new AI call (it is refused if the project changed since). Apply it with **Create editable project copy**. Other request kinds keep their output for download but can't yet be re-imported automatically.

Default deadlines are 20 minutes total, 180 seconds without data and 90 seconds to connect. Change them with `H3_AI_TIMEOUT_SECONDS` (30–3600) and `H3_AI_IDLE_SECONDS` (15–1800), for example `env H3_AI_TIMEOUT_SECONDS=1800 node start-headless.mjs`. Longer timeouts don't fix authentication, rate limits or provider overload, and provider-specific limits (such as DeepSeek's own wait limit or the Codex ceiling) still apply.

Restarting the editor interrupts in-flight AI requests but not the GPU worker. A managed sequence may pause after its current window until you reconcile and resume it.

## Codex subscription sign-in

Open **Connections → Codex subscription sign-in** and choose **Sign in with ChatGPT**. This uses the official Codex device-code login: open the displayed URL and enter the temporary code. Codex stores the login itself; Orch3stra never reads its token files, asks for your password or falls back to `OPENAI_API_KEY`. Signing in changes the Codex account for the whole server, not for one device.

The Codex model picker loads the live model catalog from your signed-in account whenever it opens (or with **Refresh live model catalog**); model IDs are never added by hand. If newer models are missing, update the Codex CLI that the editor uses (`codex update` or your package manager), restart the editor and reopen the picker; it warns when the CLI is older than 0.156.1. `CODEX_BIN` selects a different executable. Whether a model appears still depends on your account. Planner threads are read-only and tool requests are rejected.

## Reference images: one prompt per image

Each reference-image card is sent to WanGP as a single prompt (`multi_prompts_gen_type: "FG"`), so multi-paragraph prompts are not split into separate generations. If an image run stopped with WanGP's paragraph-splitting error, open **Fill references**, choose the stopped run and click **Retry image as one prompt**. It retries only that image with a new request ID, keeps completed windows, accepted pictures and spent allowances, and does not repeat the AI planning call. The new image counts against the image budget.

## Set plates: a new angle of the same place

A set plate is a new still of a location you already have (or a character in it), seen from another camera position, for example "same marble hall, reverse angle, the entrance door now behind the camera". It is made by editing the existing still(s) with an image-editing preset through the same headless WanGP worker and queue as other reference images, then saved as a normal reference asset you can attach to windows.

**In the editor:** References → **Subjects & files** → on an image file choose **New angle (set plate)**. Image studio opens with one card that uses that file as `<image1>`, a keep-the-same-room prompt and a canvas matching the source's shape. Rewrite the camera instruction, discover presets, choose **Qwen Image 2.1**, review the licence and click **Generate checked pictures**. **Use this image** saves the result in the library; attach it in **Window settings** → direct references. Nothing is generated before that confirmation.

**From an agent** (`node orch3stra.mjs reference editImage`, MCP tool `reference_edit`):

```sh
# 1. Build and validate the exact worker request; uploads, saves and submits nothing.
node orch3stra.mjs reference editImage --allow network --json '{
  "projectId": "PROJECT_ID",
  "sourceImage": "SOURCE_ASSET_ID",
  "prompt": "same marble hall, reverse angle, the entrance door now behind the camera",
  "seed": 7,
  "dryRun": true
}'

# 2. After explicit GPU approval: render, adopt and attach to a window.
node orch3stra.mjs reference editImage --allow network,cpu,gpu --json '{
  "projectId": "PROJECT_ID",
  "sourceImages": ["SOURCE_ASSET_ID", "./hall-detail.png"],
  "prompt": "same marble hall, reverse angle, the entrance door now behind the camera",
  "seed": 7,
  "windowIds": ["WINDOW_ID"],
  "licenseAccepted": true
}'
```

Fields: `sourceImage` or `sourceImages` (1–10, in `<image1>…` order) are image asset IDs of the project or local PNG/JPEG/WebP files (files are uploaded and registered first); `prompt` is the camera instruction (wrapped in a keep-the-same-room template unless it already uses `<imageN>` tokens or `literalPrompt` is true); `model` (default `qwen_image_21_7B`); `seed` (default -1); `width`/`height` (multiples of 32, 256–2048; default: the first source's aspect at 1024 px on the long edge); `steps`, `guidance` or a discovered `accelerationProfile` such as `viggle-turbo-v0.2.1-6step`; `windowIds`, `subjectId`, `title`, `requestId`; `wait` (default true) and `timeoutMs` (default 30 minutes). `licenseAccepted: true` acknowledges the model licence for this request (Qwen Image 2.1: Qwen Research License) and is never saved.

A completed run returns `assetId`, `pictureToken` (`<Picture N>`), `mediaUrl` (download with `node orch3stra.mjs download URL --output FILE`) and `attachedWindowIds`. It composes existing steps: `references register` for files, `references planImages` (one card), `generation prepareImages`, one worker `POST /generate`, `wait worker` and `references adoptImage` (with `attachWindows` when `windowIds` is given). The job queues behind any render already running. With `wait:false`, or when the wait deadline passes, it returns the job ID and the exact `wait` and `adoptImage` follow-ups; never run the edit again for the same job. A lost dispatch reply returns `OUTCOME_UNKNOWN` with the request ID to reconcile (`worker` `GET /requests/<requestId>`).

To attach an existing set plate to more windows, use `references assign` with the window's **complete** image selection, since assign replaces the direct image list:

```sh
node orch3stra.mjs call references --json '{"action":"assign","projectId":"PROJECT_ID","expectedRevision":REV,"windowId":"WINDOW_ID","assetIds":["EXISTING_IMAGE_ID","SET_PLATE_ASSET_ID"]}'
```

Models: `qwen_image_21_7B` (Qwen Image 2.1 7B, up to 10 ordered input images) is the default. `qwen_image_edit_plus2_20B` (Qwen Image Edit 2511, 20B, Apache-2.0, up to 3 inputs; the first is the image edited, no `<imageN>` tokens; 30 steps, guidance 4) is accepted too, with its own set-plate template and camera LoRA (below). WanGP downloads it as `ckpts/qwen_image_edit_plus2_20B_quanto_bf16_int8.safetensors` (20.5 GB) plus the Qwen2.5-VL-7B int8 text encoder (9.4 GB). Krea 2 `*_edit` presets take 2 inputs. Text-only presets are refused rather than dropping inputs. The older 20B Qwen Image Edit (2508/2509) presets are not worker reference presets.

### Camera LoRA (opt-in): Multiple-Angles

`multiAngleLora: true` picks the LoRA trained for the selected model; each is offered only on its own base model.

#### Qwen Image Edit 2511: `multiple-angles-2511`

[fal/Qwen-Image-Edit-2511-Multiple-Angles-LoRA](https://huggingface.co/fal/Qwen-Image-Edit-2511-Multiple-Angles-LoRA) (Apache-2.0, 96 poses, trained on 3,000+ Gaussian-splat renders) must be in WanGP's `loras/qwen/` as `qwen-image-edit-2511-multiple-angles-lora.safetensors` (295 MB). Default strength 0.9 (the card suggests 0.8–1.0). Its caption is `<sks> {azimuth} {elevation} {distance}`; `cameraView` takes the same words and is prepended:

- azimuth (45° steps): `front view`, `front-right quarter view`, `right side view`, `back-right quarter view`, `back view`, `back-left quarter view`, `left side view`, `front-left quarter view`
- elevation: `low-angle shot` (-30°), `eye-level shot` (default), `elevated shot` (30°), `high-angle shot` (60°)
- distance: `close-up`, `medium shot` (default), `wide shot`

The card's annotated form (`left side view (270°) eye-level shot (0°) close-up (×0.6)`) is accepted and normalised. A reverse angle is `back view eye-level shot medium shot`.

```sh
node orch3stra.mjs reference editImage --allow network --json '{
  "projectId": "PROJECT_ID", "sourceImage": "SOURCE_ASSET_ID", "model": "qwen_image_edit_plus2_20B",
  "prompt": "reverse angle, the entrance door now behind the camera",
  "cameraView": "back view eye-level shot medium shot", "multiAngleLora": true,
  "width": 512, "height": 896, "dryRun": true
}'
```

#### Qwen Image 2.1: `multiple-angles-v2`

`multiAngleLora: true` stacks [akhaliq/Qwen-Image-2.1-Multiple-Angles-LoRA](https://huggingface.co/akhaliq/Qwen-Image-2.1-Multiple-Angles-LoRA) (v2, step 1,500, rank 64, Apache-2.0, base Qwen-Image-2.1) on top of any Viggle profile. The worker adds it by allowlisted id (`multiple-angles-v2`); clients never send LoRA paths. The file must already be in WanGP's `loras/qwen21/` folder (`angles_v2_full_qwen21_multiple_angles_v2_qwen21_multiple_angles_v2_000001500.safetensors`, 319 MB). Discovery reports it as `profile.camera_loras[].installed`. A worker or bridge that predates this support refuses with `LORA_UNAVAILABLE` before any upload, so restart the idle bridge and worker after upgrading. Dry runs still build the request and report `multiAngleLora.warning`.

The LoRA was trained on the caption `<mva> {azimuth}, {elevation}[ close-up]`. Pass `cameraView` and it is prepended to the set-plate prompt:

- azimuth (camera orbit, 30° steps): `front view`, `front-right view`, `front-right quarter view`, `right side view`, `back-right quarter view`, `back-right view`, `back view`, `back-left view`, `back-left quarter view`, `left side view`, `front-left quarter view`, `front-left view`
- elevation: `eye-level shot`, `elevated shot`, `high-angle shot`, `top-down shot`
- add ` close-up` for a tighter (about 62%) crop. Exact degrees are not parsed; use the labels.

```sh
node orch3stra.mjs reference editImage --allow network --json '{
  "projectId": "PROJECT_ID", "sourceImage": "SOURCE_ASSET_ID",
  "prompt": "reverse angle, the entrance door now behind the camera",
  "cameraView": "back view, eye-level shot",
  "multiAngleLora": true, "multiAngleLoraStrength": 1.0,
  "dryRun": true
}'
```

A reverse angle is `back view, eye-level shot`; a side angle is `right side view` or `left side view`; an overhead plate is `top-down shot`. With `literalPrompt: true`, write the prompt yourself and start it with `<mva> …`. The card recommends a strength of 0.8–1.0 (the default is 1.0). Lower it toward 0.8 if the result copies the source view instead of moving the camera. The LoRA was trained on Objaverse objects at 512², so rooms and large canvases are outside its training data. Check results by eye. It stays opt-in. In the first room test (Oct 2026: a circular operating theatre, 288x512, Viggle 6-step, seed 7, `back view, eye-level shot`), the LoRA did not produce a reverse angle of the room. At 1.0 it turned the central apparatus into an isolated object on a grey studio background, which is its Objaverse training look, and the room was gone. At 0.8 (back view and left side view) the camera stayed frontal; the result only mirrored and reshuffled props (shelves and charts swapped sides). Without the LoRA, Qwen Image 2.1 returned an almost exact copy of the source. Neither path is a dependable reverse-angle tool for rooms yet. Reshoot single props or characters with it, or test lower strengths and more steps first.

## Upgrading safely

Update the checkout while nothing is rendering: let renders and AI requests finish (or park them), pause managed dispatch, export project backups, then stop the editor. Changes to the Node editor only need the editor restarted (`node start-headless.mjs`). Changes to the Python worker need `node start-headless.mjs --stop` (it refuses while rendering) and then `node start-headless.mjs`; the footer and `--status` show the running worker version. With systemd user services, restart `h3-director.service` for editor changes and `h3-wangp.service` for worker changes, and regenerate the units with `node scripts/install-services.mjs --install` if paths changed. Never run two editors on the same data directory. See [UPGRADING.md](UPGRADING.md) for backups, rollback and footage recovery.

## Legacy WanGP plugin

The headless worker is the default and needs no plugin. The optional legacy browser-driven adapter lives in `wan2gp-h3-director/`. To install or update it, wait until WanGP is idle, back up the existing plugin, copy `plugin.py` and `telemetry.py` (and `__init__.py` for a fresh install) into `Wan2GP/plugins/wan2gp-h3-director/`, enable it in WanGP, restart WanGP, start the adapter and enter its displayed token in the editor. Keep the initiating WanGP page open and visible while it dispatches. Voice tools do not belong in WanGP's environment for this plugin.
