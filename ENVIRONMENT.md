# Optional environment setup

Rendering uses an existing WanGP Python environment. By default Node helpers use the same selected interpreter. Legacy `H3_VOICE_PYTHON` can select a separate existing voice interpreter when `H3_PYTHON` is unset. Neither startup nor `--check` installs packages.

`node scripts/setup-tools.mjs --check` reads installed package versions. `--install-tools` is an explicit optional mutation: it records a package inventory, constrains existing renderer-sensitive dependencies, installs requirements-tools.txt, and runs pip check. Run it only between renders after backing up the environment. A freeze inventory is not a complete rollback image. No candidate verification installed dependencies.

Nemotron was designed to use a subprocess dependency overlay under the same Python interpreter so WanGP's Transformers stays untouched. Its former installer used an unpinned branch. `--nemotron` now stops before creating directories or running pip until a verified supported revision is available. Existing configured overlays remain usable, but are not verified by this candidate. requirements-nemotron.txt is a research inventory, not an install recipe. requirements-voice.txt is a legacy inventory; use the constrained installer rather than raw pip commands.

Developer checks need an existing Playwright/Chromium installation; Gradio integration additionally needs Gradio. These tools are not runtime requirements for the browser editor. Set PYTHON_BIN and CHROMIUM_BIN to those existing tools. Do not change the renderer environment to make developer tests pass.
