# H3 Director adapter 1.0.3

Fixes a task being admitted to the WanGP queue but never starting generation.
Preserves the prior live-state binding and readable/copyable-token fixes.

## Install safely

1. In Director's Send dialog, find the stuck job and click **Refresh status**, then **Cancel job**. Refresh until cancelled. Do not repeatedly submit the same plan. WanGP can autosave pending work on exit.
2. Once WanGP is idle, stop it. Back up `plugins/wan2gp-h3-director/plugin.py`.
3. Extract the plugin-only ZIP into `Wan2GP/plugins` (it contains the `wan2gp-h3-director` folder). No WanGP core, frontend JS, or Node bridge changes are needed.
4. Restart WanGP normally, reload the WanGP page, and click **Start adapter**. Check that the status includes **adapter 1.0.3**. Copy the current token into Director.
5. Keep this original WanGP browser page open and visible, preferably in a separate window next to Director. You may select Media Generator inside it. Submit once; return to WanGP if it was hidden. Gradio timers can pause in hidden browser tabs. Do not reload the page while a job is active.

**Browser dispatch** reports heartbeat and dispatch status; **Check browser dispatch** runs the same check manually. Job JSON now distinguishes waiting for browser dispatch, dispatch requested, admitted but not started, and observed native generation. Idle jobs gain an actionable warning, not a fake failed/completed result. Do not confuse HTTP 200 or an “admitted” log with rendering.

This adapter uses the existing browser-owned WanGP event chain. It is not headless and does not create a second GPU runtime. After a page reload/session change, cancel pending work before stopping/restarting the adapter to bind the new page. Existing browser projects remain intact; do not clear storage.

## What was verified

39 mock-based adapter tests with real local HTTP; eight real-Gradio 6.5.1 request/state/dependency checks with modeled WanGP and client scheduling; Python 3.10 grammar; 13 JS smoke checks in the complete project. Browser navigation was blocked in the build environment. No live WanGP, actual Gradio 5 browser, GPU render, or authenticated provider was tested. The complete project ZIP contains the tests and updated README/AGENTS/RESEARCH/CHANGELOG.
