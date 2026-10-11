# Orch3stra 2.2.2 — WanGP settings compatibility

## The reported failure

> Unknown settings: mask, audio_file (use audio_scale).
> Model-specific options belong in custom_settings.

The 2.2.1 worker unconditionally added `mask: null` and `audio_file: null` when
clearing unused media on every H3 generation. Those are not supported top-level
settings in current WanGP. Validation rejects their names even when the values are
null. This fails before model inference; it is unrelated to the number/quality of
approved reference pictures and does not require another reference-fill pass.

The current official settings reference documents image_mask/video_mask for masking,
audio_guide/audio_guide2 for the two voice/reference inputs, and audio_scale as a
numeric strength. `audio_scale` is not a filename replacement. The generic
custom_settings advice is not a reason to put these empty attachment placeholders
there or to change your working H3 custom options.

## Scope of the fix

* Remove the two invalid keys from fresh H3 resolution and from the dispatch copy of
  previously queued resolved H3 settings. Empty string and None are the ONLY discarded
  values. Nonempty legacy fields are rejected with a useful message; unknown unrelated
  settings remain for WanGP to validate.
* Keep ordered image_refs and audio_guide/2, sampler/seed, 24-fps frame budgets,
  continuation source/prefix, overlap, prompt bytes and custom_settings untouched.
* Keep existing SQLite payloads, resolved snapshots, digests and request/client IDs.
  A queued record can use the fixed dispatch without being resubmitted. Failed jobs
  remain failed and are not replayed on startup or under their old request ID.
* Health now reports h3_settings_compatibility:1. Bridge/worker version is 2.2.2.
  The launcher's old-worker warning does not kill or reconfigure a running renderer.
* Progress no longer uses 'Finished' for a failed film. Failure/cancellation are distinct
  outcomes; a saved phase='finished' does not override status='failed'.

No project contents or media are rewritten by installing this release. Reference
agent, budgets through 20, progress checkpoints, sound library, Post, scene editor,
image-family support, and other 2.2.1 features are retained.

## Manual-launch upgrade

1. Export a portable backup from the existing project with your approved references.
   If a reference run finished but is not applied, use its existing Apply/Save-progress
   workflow first; this update does not silently merge an unapplied result.
2. Let other GPU/AI jobs finish or park. Park automatic managed dispatch. Stop the OLD
   Director Node process before stopping the worker so it cannot dispatch a new task.
3. Extract this complete archive into a fresh stable folder. From its h3-director
   directory, preserve any custom H3_DATA_DIR / H3_PYTHON and other environment settings:

```sh
node start-headless.mjs --stop
node start-headless.mjs
```

The first command refuses an active render. Do not force-kill it to apply an update.
The second starts the new worker using your existing WanGP checkout/interpreter.
No pip install, git pull, plugin update or token copy is part of this fix.

4. Reopen the same URL and browser profile. In Activity / WanGP server check WORKER
   **2.2.2**, as well as bridge 2.2.2. Node alone may reconnect to worker 2.2.0: that
   is not a worker upgrade. The console now warns about the missing capability.
5. Inspect the queue after restarting. Recovered queued work may be paused; unpause
   only when you are ready for those jobs to run. Stored tokens/media persist.

Default data: ~/.local/share/h3-director. Default WanGP checkout:
/path/to/Wan2GP. Default browser URL: http://your-hostname:8765.
Keep old release folders while any process still runs from one. Do not clear site data
or import an old portable backup over your successfully reference-filled project.

## systemd user services

Wait for idle, park dispatch, then stop **h3-director.service first** and then
**h3-wangp.service** using your user-service controls. Unlike the manual idle-stop
command, systemctl stop itself does not enforce the worker's idle guard.

Update both units to the new release folder, preserving overrides, working directories
and H3_DATA_DIR. From a stable new folder the existing
`node scripts/install-services.mjs --install` regenerates units (review any custom
unit changes/overrides before replacing them). Run `systemctl --user daemon-reload`,
then start h3-wangp.service and h3-director.service. Do not start another manual copy.
Check the worker version after it reports ready. No root privileges are necessary.

## Retry the film without repeating reference work

The screenshot is a terminal **failed** film with **0 / 249 windows saved**. It is a
historical failed submission, not a paused sequence. Leave it in history.

Open the CURRENT project that contains the completed/applied references. On Timeline,
select the first window and use **Render from here…**, or **Choose windows…** and
choose the needed range. Confirm a NEW render, with Director-managed continuation as
before. A one-window test first is useful; then use the suffix range to continue.
None of these actions requires running Fill missing coverage again. Do not reuse an
old native job/request ID; it correctly continues to identify its original failure.

For a later failure with saved frames, **Continue unfinished…** reconnects available
footage, or choose the suffix and 'Keep and continue the existing edited prefix'.
No unseen/corrupt footage or uncertain render completion is assumed safe. Generating
new work continues under the existing explicit reference-agent/video policies.

## Verification and limits

The regression harness deliberately rejects `mask`/`audio_file`, even with None values.
It reproduces the prior failure, then exercises H3 resolution/dispatch, one/two voice
inputs, nine ordered pictures, PDD/standard settings, continuation, old queued records,
new vs old request IDs, and persistence. It uses real temporary files and SQLite with
a synthetic renderer, not WanGP inference. Other local tests exercise HTTP, FFmpeg and
browser controls with their documented fixtures.

Run:

```sh
python3 -m unittest discover -s tests -p test_settings_compat.py -v
node scripts/check-progress.mjs
node scripts/check-all.mjs --integration
```

The exact installed WanGP commit, live H3/Qwen/Krea inference, physical phone and GPU
memory behavior have not been tested here. The fix targets this reproduced strict-key
failure, not a guarantee against every future upstream API change. The release log
records the actual tests executed; historical VALIDATION documents describe old builds.

## Upstream sources reviewed for this release

Current official wgp.py declared WanGP 17.10 when inspected. We checked the settings
reference and public API validation path; we did not modify that repository.

- https://raw.githubusercontent.com/deepbeepmeep/Wan2GP/main/docs/SETTINGS.md
- https://raw.githubusercontent.com/deepbeepmeep/Wan2GP/main/wgp.py
- https://raw.githubusercontent.com/deepbeepmeep/Wan2GP/main/shared/api_cli.py
- https://raw.githubusercontent.com/deepbeepmeep/Wan2GP/main/shared/api.py

These are moving upstream links, not a bundled/pinned WanGP dependency. No source
code, weights, login credentials or private project media from that service is shipped.
