# Adapter 1.0.5

Install only after existing generation finishes. This release needs both the full 1.0.5 Director webapp/Node bridge and these plugin files. It includes prior 1.0.4 features; no intermediate upgrade is necessary.

Back up the current plugin, stop WanGP once idle, then copy `plugin.py` and `telemetry.py` into the existing `Wan2GP/plugins/wan2gp-h3-director/` directory. Keep `__init__.py`. For a fresh install copy this whole folder and enable it in WanGP. Restart WanGP, reload its browser page, start the adapter, and verify the visible status says 1.0.5. Enter the newly displayed token in Director. Restart the Node bridge from the new release folder and reload the editor at its previous exact URL/profile.

Keep the initiating WanGP page open and visible. The working browser-driven queue dispatch from 1.0.3 is intentionally preserved; this is not a headless API.

Voice packages install in the Director folder's optional `.voice-venv`, NOT WanGP's `.venv`. They are not needed by this Python plugin. See the top-level README for setup and safety limits.

Existing movies remain in WanGP's output directory. Adapter IDs are memory-only. Use Director → Renders → Import finished full film to map an older completed movie to its original 24-fps linked timeline. Do not claim imported films have historical denoising statistics.

New native continuation and ordinary-preset exports are fixture-tested but require validation against the installed WanGP revision. Start with one short alternate take and preserve originals.
