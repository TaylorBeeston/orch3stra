# Post and backups

Keep editable project data safe and finish real selected footage in a separate Post cut without regenerating originals. Use [SKILL.md](../SKILL.md), [verify.py](../scripts/verify.py), and the [baseline](README.md). These recipes are source-grounded and unexecuted until supported by a run's recorded evidence.

## Sub-features

- `post-empty-state`: distinguish an accessible Post room from an actual finishing cut.
- `post-cut-export`: create a cut from real saved footage, edit a finish, and obtain a decodable Post MP4.
- `backup-download-restore`: download project/portable data and restore it through the UI.
- `backup-studio`: save a verified portable backup to the isolated studio and reopen its status.

## How to get to it (user POV)

- **Post room:** Post navigation or Overview → Finish the film → Open Post room; All tools / settings (also Ctrl+K) → Post; or Export → Post movie with music, logos and fades…. Back to director exits the separate room.
- **Create/export cut:** Post room → Start from current edited film or Start from selected take only; then Master finish, clip controls, and Export Post MP4. A completed export exposes Download Post MP4 in Post exports.
- **Backups:** Post → Export and backups, or All tools → Export. Project JSON, Portable backup + media, Save portable backup on studio computer, and Saved backup status… are in this export dialog.
- **Restore:** Projects from the topbar or tool finder → Import project / backup.
- **Other export route:** Export → Timeline movie… opens a different finishing path for the selected timeline takes. It is not the Post export exercised here; do not count one as proof of the other.

## Driving it with Playwright

Preconditions:

- Use a uniquely named fresh project with a saved brief and **no missing source-media references** for baseline backup checks. The seeded demo is not guaranteed to contain its source bytes. Capture its name/brief before export.
- Post's complete journey needs a real selected finished take for every included window, available source bytes, FFmpeg/FFprobe on the isolated bridge, enough disk space, and permission for CPU finishing. The baseline has no finished footage: `post-cut-export` is **FAIL — precondition**. Do not use empty navigation as a substitute. GPU upscale, music generation, and speech recognition are not authorized by this recipe.
- Set `evidence_dir` to the run's preserved evidence directory; downloads remain there. No real user project is overwritten during restore.

- **Open Post without footage → honest empty state.**
  ```python
  page.locator('nav.workspace-navigation [data-workspace-area="post"]').click()
  page.locator('#workspace-home [data-post="open"]').click()
  expect(page.locator('#post-workspace')).to_be_visible()
  expect(page.locator('#post-inspector')).to_have_text('No Post cut yet.')
  expect(page.locator('#post-summary')).to_have_text('Start with the current finished film or a single selected clip.')
  page.locator('#post-workspace [data-post="close"]').click()
  expect(page.locator('#post-workspace')).not_to_be_visible()
  ```
  Separately exercise tool-finder `#dialog [data-post="open"]` and Export's `#dialog [data-post="open"]` if claiming those entrypoints.
- **Download metadata → exact user values in actual file.**
  ```python
  page.locator('#workspace-home [data-action="export"]').click()
  expect(page.locator('#dialog-title')).to_have_text('Export movie or project backup')
  with page.expect_download() as pending:
      page.locator('#dialog [data-action="export-project"]').click()
  downloaded = pending.value
  metadata_path = evidence_dir / downloaded.suggested_filename
  downloaded.save_as(str(metadata_path))
  ```
  Parse this actual JSON read-only and assert its `name` and `request` equal the values saved in the project recipe. Record filename, size, and hash. This proves a project-data download, not a playable movie.
- **Portable download/restore → user-facing state round-trips.** Use `page.expect_download()` around `page.locator('#dialog [data-action="export-portable"]').click()` and preserve the resulting file. Close Export, open Projects, and use the visible Import project / backup action with the file chooser:
  ```python
  page.locator('.workspace-header-actions [data-action="projects"]').click()
  with page.expect_file_chooser() as chooser:
      page.locator('#dialog [data-action="import-project"]').click()
  chooser.value.set_files(str(portable_path))
  expect(page.locator('#project-name')).to_have_value(saved_name)
  page.locator('nav.workspace-navigation [data-workspace-area="story"]').click()
  expect(page.locator('#request')).to_have_value(saved_brief)
  ```
  Here `portable_path` is the downloaded portable file and `saved_name`/`saved_brief` are the recorded originals, not fixture values. Save/reload and assert both again. A fresh second context on this same run URL can demonstrate independent restore without preexisting browser data. If claiming media round-trip, reopen and decode every included real source; the media-free baseline proves metadata round-trip only.
- **Studio backup → completed status with durable hash/path.** Open Export, click `#dialog [data-action="save-portable-disk"]`, and `expect(page.locator('#backup-disk-status')).to_contain_text('SHA-256', timeout=120000)`. Capture the actual ID, path, and hash. Click `#dialog [data-action="backup-history"]`; assert `#dialog-title` is `Saved portable backups` and `#dialog-body` contains that exact backup ID, hash, and `completed`. Reopen the same status after reload. Read-only hash/file evidence must agree with the reported backup; a toast alone is not sufficient. Do not automatically retry a failed or uncertain backup.
- **Authorized full Post export → editable cut, persisted finish, real MP4.** Select the intended saved timeline window and enter Post. Click `#post-workspace [data-post="start-selected"]` (or `start-all` only when every included window has saved footage). Expect `#post-inspector` no longer to say `No Post cut yet.` and inspect the actual clip/source. Fill `[data-post-master="fadeOutFrames"]` with `0.25`, press Tab to commit, and `expect` that input to have value `0.25`; use a source longer than half a second so the fade fits. Close, wait for local save, reload, reopen Post and assert the value persists. Play via `#post-workspace [data-post="play"]`; require `#post-video` decode/time advancement and inspect the audible/visible result. Click `#post-workspace [data-post="export"]` only with CPU-export authorization, observe the actual job reach completed in `#post-jobs`, and download its `a` with text `Download Post MP4` using `page.expect_download()`. Retain job ID/hash and use read-only FFprobe plus playback of the actual downloaded file to check positive duration, expected video/audio streams, frame count, and the intended fade. Opening Export, creating a job, or obtaining an HTML error download is not success. Both start-selected and start-all require their own evidence if claimed.

## Gotchas

- Portable backups include available reference/Post/audio source media but **not worker-owned rendered clips**. Keep actual rendered outputs separately. Metadata-only backup success does not establish media recovery.
- The separate Post cut can become stale when generation edits change. Export is intentionally blocked until an explicit rebuild; do not bypass the source-change warning.
- Post fade inputs are in seconds despite `*Frames` selector names. Press Tab so the change handler commits the edit.
- Starting again can replace an existing Post cut after confirmation. Use the disposable project and preserve the prior evidence, never blindly accept a replacement prompt.
- Export Post MP4 is CPU work, while later upscale controls use the GPU. Neither authorization follows from opening the room. Baseline lack of footage must remain visible in the report.
- Studio backups have a 64 MiB encoded-JSON cap; worker clips are outside that backup regardless of size. Report limit/missing-source errors rather than dropping content to manufacture a pass.
