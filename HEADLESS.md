# Headless runtime

Use an existing, separately installed WanGP environment. `node start-headless.mjs --setup` saves reviewed nonsecret root/interpreter paths; `--check` runs model-free required checks and advisory hardware inspection. It does not install packages, import the renderer, load weights or accept licenses. Default editor bind is 127.0.0.1:8765. The worker binds to 127.0.0.1:7867 and uses a persistent private token.

The launcher starts or reuses a detached worker. Node and browser polling do not own accepted native tasks. Ctrl-C stops Node; it does not cancel a task or stop the worker. `--status` is read-only. `--stop` explicitly stops an idle worker and refuses active rendering. Do not run another Gradio renderer over the same checkout/GPU. The checkout lock guards duplicate workers, not every external GPU program.

The worker persists jobs/uploads/outputs in SQLite and dispatches one SDK SessionJob at a time. Repeated request IDs are idempotent only for the same payload. Lost replies require lookup/reconciliation, never blind replay. Restart marks in-flight jobs interrupted and pauses queued jobs. A paused queue needs deliberate resume; the editor offers **Resume renderer queue** when a new render meets a paused queue. A clean `--stop` with nothing queued no longer persists the pause, and an explicit user pause is kept. WanGP keeps the last model pinned in RAM between jobs; the worker releases it after `H3_IDLE_RELEASE_SECONDS` idle seconds (default 900, `0` disables) or when you choose **Free model memory**, and the next job reloads it. If the worker process dies (for example the Linux out-of-memory killer), Render overview and Sequences say so and offer **Restart renderer**. Cancellation is cooperative: keep the GPU slot owned until cancellation reaches terminal state.

Managed continuation is coordinated by Node. Node failure stops further coordinator submissions while the accepted native task may finish. On return inspect the same job and reconcile archival state before resuming. Bounded continuation uses verified owned decoded-media artifacts and frame counts. It does not promise arbitrary diffusion-checkpoint recovery, or sample-identical equivalence with a monolithic render. Stock/installed SDK capabilities are checked; unsupported operations fail closed.

H3 timing uses 24fps and the 17k+5 generation grid. Retained new frames plus reused overlap form the generated span. Exact output frames/FPS are checked before mapping footage to windows; partial/mismatched files remain unmapped. Historical job snapshots and output ownership are immutable. Native linked audio references cannot vary unsafely between windows; use an explicitly supported independent/managed path after reviewing its context.

Reference stills, including edits of existing stills ("set plates": a new camera angle of the same place, see [docs/USAGE.md](docs/USAGE.md#set-plates-a-new-angle-of-the-same-place)), run on the same worker as `reference_image` tasks. Inputs are owned `h3media:` upload IDs, never paths, and every task resolves with image_mode 1 and video_prompt_type `I`, one prompt per image. The worker accepts these presets, discovered from WanGP's registry:

- Qwen Image Edit 2511 (`qwen_image_edit_plus2_20B`): the set-plate default. Up to 3 ordered `image_refs`, the first edited, with no `<imageN>` tokens. 30 steps, guidance 4, Apache-2.0.
- Qwen Image 2.1 (`qwen_image_21_7B`): up to 10 ordered `image_refs`, with `<imageN>` prompt tokens.
- Krea 2.

The first discovery of an image preset needs the worker idle; later lookups are cached.

The optional `camera_lora` task field (with `camera_lora_strength` in (0, 2]) names an allowlisted camera LoRA for that architecture only. `multiple-angles-2511` (fal Qwen-Image-Edit-2511 Multiple-Angles, file in `loras/qwen/`, prompt trigger `<sks>`, default 0.9) is used by default for 2511 set plates. `multiple-angles-v2` (Qwen 2.1, file in `loras/qwen21/`, trigger `<mva>`) is opt-in. The worker adds the LoRA only if WanGP lists its file, and the prompt must contain the trigger. On Qwen 2.1 it goes after any Viggle accelerator LoRA. Discovery reports `profile.camera_loras[].installed`.

Clients refuse before uploading (`MODEL_UNSUPPORTED` / `LORA_UNAVAILABLE`) when the worker lacks 2511 or the LoRA. Worker support for 2511 and camera LoRAs needs the bridge and worker restarted (idle) on code that includes it. Expect about 80 s per 512x896 plate on a 16 GB GPU (about 115 s cold), with a worker peak of about 10 GB VRAM and about 33 GB RAM.

Example dry run, which builds and validates the request without submitting: `node orch3stra.mjs reference editImage --allow network --json '{"projectId":"PROJECT_ID","sourceImage":"ASSET_ID","prompt":"the same hall seen from its right side","cameraView":"right side view eye-level shot medium shot","dryRun":true}'`.

Private data defaults to ~/.local/share/h3-director. Keep backups of the entire data directory, browser-origin projects/media, source/output locations and reviewed service settings. Moving files can invalidate stored device/inode/mtime ownership. Follow [docs/UPGRADING.md](docs/UPGRADING.md); do not rewrite stat locks or assume copied files are accepted continuation sources.

For network access set H3_HOST deliberately and review H3_HOSTNAMES/H3_PUBLIC_ORIGIN, pairing and transport security. HTTP is not encrypted. Keep the worker private. User services are opt-in via scripts/install-services.mjs; they capture exact paths and are never installed or started automatically.

Offline tests use fake SDK responses, real disposable HTTP/SQLite/files and CPU codecs. They do not verify new inference, GPU compatibility, model licensing or a clean-machine install.
