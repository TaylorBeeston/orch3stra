# Render review

Select exactly which windows would render, inspect the missing-footage state honestly, and—only with real authorized resources—render or import footage, audition takes, and persist the selected result. Follow [SKILL.md](../SKILL.md), [verify.py](../scripts/verify.py), and the [baseline](README.md); these are source-grounded recipes rather than passed checks.

## Sub-features

- `render-selection-review`: inspect/select windows without submitting generation.
- `render-empty-state`: show the real absence of saved footage and candidates.
- `render-submit`: complete an explicitly authorized selected-window generation against a real worker.
- `render-takes-playback`: import or select actual finished footage, audition it, and retain the choice.

## How to get to it (user POV)

- **Timeline:** Timeline navigation or Overview → Review and render.
- **Selection review:** Timeline's Render from here…, Choose windows…, Continue unfinished…, and Select on timeline (then Choose windows…). All tools / settings or Ctrl+K → Render windows… is the tool-finder entry. Scene toolbar → Render scene… opens the same review with that scene selected. Inside the dialog: From current window to end, From first missing to end, Only missing windows, All, Clear selection, and the From/Through range controls change the proposed selection.
- **Saved footage:** click a timeline window or rendered-footage chip; the Program monitor offers Window, Sequence, Previous window, and Next window. Selected editor → Takes opens candidates. The full-film upload is available from Program monitor → Import finished film, or Takes → Import a finished full film.
- **Observation:** All tools → Renders or Activity → Renders opens the render monitor; managed sequence controls are also reachable from Studio → Manage sequences / reconnect and the selection dialog. Opening a monitor is not submission or successful rendering.

## Driving it with Playwright

Preconditions:

- The isolated demo or a fresh local project has windows, but no finished footage. Selection and empty-state checks require no GPU.
- `render-submit` requires explicit GPU authorization, real worker connectivity/authentication, available model/weights, reviewed model settings and prompts, and all selected references present. None is supplied by the baseline: **FAIL — precondition** for complete rendering.
- Playback/import needs real decodable footage and a matching linked timeline, plus an available adapter/worker for import. Preserve the source hash and confirm actual duration/order at 24 fps. These are also absent: **FAIL — precondition** for the complete media journey. Never invent completed jobs.

- **Review selection safely → exact checked count is shown.**
  ```python
  page.locator('nav.workspace-navigation [data-workspace-area="timeline"]').click()
  page.locator('.render-selection-toolbar [data-render-select="choose"]').click()
  expect(page.locator('#dialog-title')).to_have_text('Render selected windows')
  page.locator('#dialog [data-render-select="none"]').click()
  expect(page.locator('#render-window-list input:checked')).to_have_count(0)
  page.locator('#dialog [data-render-select="all"]').click()
  count = page.locator('#render-window-list input[data-render-pick]').count()
  expect(page.locator('#render-window-list input:checked')).to_have_count(count)
  expect(page.locator('#render-selection-summary')).to_contain_text(f'{count} selected')
  ```
  Close without submission. Repeat using toolbar `[data-render-select="from"]`, `[data-render-select="unfinished"]`, tool-finder `#dialog [data-render-select="choose"]`, or scene-toolbar `[data-scene-edit="render"]`, recording the expected IDs/range for each. For picking, click toolbar `[data-render-select="pick"]`, then a specific clip's `button[data-render-pick]`, and reopen Choose windows; assert that same ID is checked. Use the actual UI-derived window IDs, not hardcoded fixture IDs.
- **Inspect no-footage state → no false playback claim.**
  ```python
  page.locator('#dialog [data-action="close-dialog"]').click()
  expect(page.locator('#program-empty')).to_contain_text('no finished take yet')
  page.locator('.editor-tools [data-action="takes"]').click()
  expect(page.locator('#dialog-body')).to_contain_text('No render for this window yet')
  expect(page.locator('#dialog [data-take-use]')).to_have_count(0)
  ```
  These assertions apply only to a project with no jobs. Capture the missing prerequisite, rather than pressing Play and calling an empty screen success.
- **Authorized selected render → real accepted job, output, and playback.** Review selected IDs, `#render-strategy`, `#render-context`, and `#render-selection-seed` in the selection dialog; choose fresh versus existing edited-prefix context deliberately. Only after authorization, click `#dialog [data-render-select="submit"]`, inspect `#app-confirm-summary`, and approve the exact count/model/context. Observe the real job in Renders/Sequences until terminal success; retain its ID and output metadata. A status without an available decodable video fails. Return to the matching timeline window, assert `#program-video` is visible, click `[data-studio-action="play"]`, and use a read-only media assertion such as `page.wait_for_function("() => { const v = document.querySelector('#program-video'); return v && v.readyState >= 2 && v.currentTime > 0 && !v.error; }")`. Also listen/watch for the intended shot and audio; timing advancement alone does not prove creative correctness. Reload and confirm the saved take still resolves.
- **Authorized import → indexed film then selectable windows.** From Timeline, click `[data-studio-action="import-film"]`; assert `#dialog-title` is `Import an existing completed film`. Set `#take-import-file` to the actual permitted film, check `#take-import-confirm` only after matching timeline/order/hash, then click `#dialog [data-take-action="import-submit"]`. Require actual upload/index success and matching windows with available saved video, then apply the playback assertion above. The alternate entry is Takes' `#dialog [data-take-action="import"]`. Import is not generation proof and does not recover historical inference metadata.
- **Select a real alternate take → persisted choice.** Open Takes for the intended window, identify the real candidate by its job ID/name, click that candidate's `[data-take-play]` to audition, then return to Takes and click its enabled `[data-take-use]`. Assert that candidate contains `selected for review` and its Use this take button is disabled. Reload, select the same window, reopen Takes and assert the same candidate remains selected; play it again. This requires at least two real available candidates if claiming a change of take, not merely the sole default candidate.

## Gotchas

- Continue unfinished creates a selection using current prompts; it is not permission to restart an old crashed submission or restore its frozen script.
- A queue-offline error in the selection panel is valid missing-worker evidence. Do not hide it or treat successful panel opening as a full render pass.
- Choosing a take changes review selection, not pixels, historical originals, or successor continuity. Inspect joins separately.
- Render buttons may be enabled without meeting all eventual dispatch preconditions. Never use enabled state as authorization.
- Monitor playback needs a selected real range. Baseline empty states cannot prove decode, audio, sequence transitions, import, or take persistence.
