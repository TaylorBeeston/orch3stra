# Changelog

## Unreleased

First-run and recovery fixes found by dogfooding a full film. `--setup` accepts piped answers and offers the detected WanGP paths; `--check` prints a plain verdict and a readable GPU line. The planner link under the brief opens Connections, and the preset picker separates supported Ref2VA presets from ones the worker rejects. A paused renderer queue offers a one-click resume instead of an error, an idle clean shutdown no longer persists the pause, and the startup banner mentions a paused queue. When the worker process dies, Render overview and Sequences explain why (including likely OOM) and offer **Restart renderer** (`/api/renderer`, refused while the worker is alive). Image-studio renderer choices survive the panel re-rendering; first drafts no longer show “Window no longer exists”; Story + cast proposals name the film; GPT-6.x Sol models get the larger refinement budget; window counts are pluralized; and `tests/test_release_restore.py` imports like its siblings so `check-all` passes.

## 2.3.0

Adds explicit preferred/exceptional generated-window timing policy, model-grid ceilings, planner packet guidance and editable reason/risk review. Existing timing remains intact until deliberate edits. Adds model-scoped image-license acknowledgement, conservative blob response headers, portable host defaults and stronger model-free FFmpeg preflight. Nemotron dependency installation now uses pinned transformers 5.19.0, tokenizers 0.23.3 and huggingface_hub 1.33.0 instead of Transformers' unpinned main branch.

Includes reference inspection/coverage repair, speech-review flags, soundtrack placement, portable backups, interrupted-request recovery and bounded continuation from the prior 2.3.0 review source. Tests use fake provider/SDK responses and synthetic data; no new live-model verification is claimed.

The repository excludes private historical validation notes, owner-derived examples and the separately attributed upstream WanGP mux patch pending licensing review. MIT is applied to original app-owned source. No model/backend license is accepted on the owner's behalf.
