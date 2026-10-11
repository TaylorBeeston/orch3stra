# Install H3 Director 1.0.4

Let the current working render finish. Do not hot-reload, stop, or cancel it just to install monitoring. Export a portable project backup first. This release changes the frontend, bridge, compiler, and plugin.

1. Stop WanGP and the Node bridge when idle.
2. Extract the complete ZIP into a fresh folder, keeping the old app copy as a backup.
3. From the extracted `h3-director` directory, run:

```sh
cp /path/to/Wan2GP/plugins/wan2gp-h3-director/plugin.py \
   /path/to/Wan2GP/plugins/wan2gp-h3-director/plugin.py.pre-1.0.4

cp wan2gp-h3-director/plugin.py wan2gp-h3-director/telemetry.py \
   /path/to/Wan2GP/plugins/wan2gp-h3-director/

node scripts/check.mjs
node scripts/check-render.mjs
node bridge.mjs
```

`telemetry.py` is a new required sibling file. `__init__.py` is unchanged. No npm install is needed. To run the plugin in a different WanGP checkout, adjust that destination path.

4. Restart WanGP with your usual command. Reload its browser page, start the adapter, and verify `adapter 1.0.4`.
5. Reload Director at your previous exact origin (normally `http://127.0.0.1:8765`) and browser profile; enter the new adapter token in Connections. Keep the original WanGP page open/visible throughout generation.

New stats and render mappings start with a new Director submission. Existing files remain in WanGP's gallery and can be voice-converted/upscaled there without repeating H3 generation. Restarting the adapter clears its in-memory job/output index; this update does not reconstruct the already-running 1.0.3 job or its past timings. Do not clear browser storage.

All new routes remain loopback/Host/Origin/Bearer protected. Video streaming requires the updated Node bridge. Publicly exposing either service is not supported.
