# Image-model families and extensionless frame fix — 2.2.0

The native registry is queried for supported Qwen Image 2.1 and Krea 2 architectures.
This is not a generic adapter for every image model in WanGP: unsupported architectures
are deliberately not presented as working presets. Update WanGP itself normally when
its native Krea handlers/presets are not installed; Director does not update the checkout.

Krea profiles reflect the upstream native handler:

| Native architecture | Reference inputs | Default steps | Default guidance |
|---|---:|---:|---:|
| krea2_raw | 0 | 52 | 3.5 |
| krea2_turbo | 0 | 8 | 0 |
| krea2_raw_edit | up to 2 | 20 | 2 |
| krea2_turbo_edit | up to 2 | 8 | 0 |

Text-only presets cannot silently discard identity anchors. Editing presets support
ordered references; **Preserve first scene image** enables the native first-scene
conditioning mode. Selecting it is explicit; Director does not reorder the inputs.
Review the native preset's license and hardware requirements. Krea is not assumed to
have the same license as Qwen. Family changes clear incompatible Qwen/Viggle settings.

Existing-image inspection, generated-image review, rejection/retry, original-identity
consent, and per-run budgets still apply. A model declaring the image good is not a
measured guarantee of identity fidelity. No live Krea/Qwen generation was tested here.

Source inspected during this update:
https://raw.githubusercontent.com/deepbeepmeep/Wan2GP/main/models/krea2/krea2_handler.py

## The prior 2 GiB error

Reference-frame display names such as `Previous rendered context · frame 2746` had no
extension. The upload boundary now adds `.jpg` when MIME identifies JPEG and the name
has no extension; cached sources in old paused runs are covered too. New sampled frames
also carry a valid filename. Bytes and hashes are unchanged, and upload limits remain.

The worker now reports unsupported filenames separately from empty/oversized uploads.
Resume the saved reference run after upgrading; there is no need to delete inputs or
rerender completed footage merely to correct its filename.

This release includes worker-side image discovery/dispatch changes. Stop/restart the
idle worker using the new launcher before relying on the additional model families.
