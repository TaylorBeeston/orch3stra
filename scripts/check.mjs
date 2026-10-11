#!/usr/bin/env node
/** Local smoke checks only. No AI provider, GPU, or running WanGP required. */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFile,mkdtemp,rm } from 'node:fs/promises';
import {tmpdir} from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from '../bridge.mjs';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const require = createRequire(import.meta.url);
const H3 = require('../core.js');
let checks = 0;
async function check(name, fn) {
  await fn();
  checks++;
  console.log(`PASS ${name}`);
}

async function main() {
  await check('All JavaScript parses', () => {
    for (const name of ['core.js', 'timing-core.js', 'timing-ui.js', 'edit-core.js', 'post-core.js', 'studio-core.js', 'storage.js', 'providers.js', 'speech-core.js', 'speech-review-core.js', 'speech-quality-core.js', 'speech-quality-ui.js', 'speech-review-ui.js', 'speech-ui.js', 'takes-ui.js', 'direction-ui.js', 'soundscape-ui.js', 'studio-ui.js', 'backend-ui.js', 'sequence-ui.js', 'ai-ui.js', 'progress-core.js', 'progress-ui.js', 'editor-ui.js', 'render-selection-core.js', 'render-selection-ui.js', 'reference-core.js', 'reference-ui.js', 'clinic-core.js', 'film-core.js', 'clinic-ui.js', 'film-ui.js', 'voice-studio.js', 'codex-ui.js', 'scene-core.js', 'doctor-core.js', 'reference-agent-core.js', 'coverage-ui.js', 'scene-ui.js', 'post-ui.js', 'scene-edit-core.js', 'scene-edit-ui.js', 'sound-core.js', 'sound-ui.js', 'workspace-ui.js', 'image-crop-ui.js', 'music-ui.js','app-confirm.js', 'pending-intent.js', 'app.js', 'bridge.mjs', 'finish-server.mjs', 'post-server.mjs', 'ai-server.mjs', 'ai-stream.mjs', 'sequence-server.mjs', 'scripts/check-sequences.mjs', 'scripts/check.mjs']) {
      const result = spawnSync(process.execPath, ['--check', join(root, name)], { encoding: 'utf8' });
      if (result.error) throw result.error;
      assert.equal(result.status, 0, `${name}: ${result.stderr || result.stdout}`);
    }
  });

  await check('Documented files and browser script order are present', async () => {
    const html = await readFile(join(root, 'index.html'), 'utf8');
    const scripts = [...html.matchAll(/<script\b[^>]*src="([^"]+)"/g)].map(m => m[1]);
    assert.deepEqual(scripts, ['core.js', 'timing-core.js', 'timing-ui.js', 'edit-core.js', 'post-core.js', 'studio-core.js', 'storage.js', 'providers.js', 'speech-core.js', 'speech-review-core.js', 'speech-quality-core.js', 'speech-quality-ui.js', 'speech-review-ui.js', 'speech-ui.js', 'takes-ui.js', 'direction-ui.js', 'soundscape-ui.js', 'studio-ui.js', 'backend-ui.js', 'sequence-ui.js', 'ai-ui.js', 'progress-core.js', 'progress-ui.js', 'editor-ui.js', 'render-selection-core.js', 'render-selection-ui.js', 'reference-core.js', 'reference-ui.js', 'clinic-core.js', 'film-core.js', 'clinic-ui.js', 'film-ui.js', 'voice-studio.js', 'codex-ui.js', 'scene-core.js', 'doctor-core.js', 'reference-agent-core.js', 'coverage-ui.js', 'scene-ui.js', 'post-ui.js', 'scene-edit-core.js', 'scene-edit-ui.js', 'sound-core.js', 'sound-ui.js', 'workspace-ui.js', 'image-crop-ui.js', 'music-ui.js','app-confirm.js', 'pending-intent.js', 'app.js']);
    for (const name of [...scripts, 'styles.css', 'workspace.css', 'bridge.mjs', 'README.md', 'AGENTS.md', 'THIRD_PARTY_NOTICES.md', 'LICENSE', 'SECURITY.md', 'CONTRIBUTING.md',
                        'wan2gp-h3-director/plugin.py', 'wan2gp-h3-director/__init__.py']) {
      await readFile(join(root, name));
    }
  });

  await check('Default project survives normalization', () => {
    const p = H3.newProject();
    const restored = H3.normalizeProject(JSON.parse(JSON.stringify(p)));
    assert.equal(restored.id, p.id);
    assert.equal(restored.version, 1);
    assert.equal(restored.windows.length, 1);
  });

  await check('Demo geometry counts retained footage, not duplicated overlap', () => {
    const p = H3.demo();
    const rows = H3.schedule(p);
    assert.equal(rows[0].overlap, 0);
    for (const [i, row] of rows.entries()) {
      assert.equal(row.start, i ? rows[i - 1].end : 0);
      assert.equal(row.end - row.start, row.kept);
      assert.equal(row.span, row.kept + row.overlap);
      assert.equal((row.span - H3.OFFSET) % H3.STEP, 0);
      assert.ok(row.span >= H3.MIN);
      assert.ok(row.overlap <= row.start);
      assert.ok(row.contextStart >= 0);
    }
    assert.equal(rows.at(-1).end, rows.reduce((sum, r) => sum + r.kept, 0));
  });

  await check('Sliding compilation has one paragraph per window and a hard-cut marker', () => {
    const p = H3.demo();
    const paragraphs = H3.compile(p).split('\n\n');
    assert.equal(paragraphs.length, p.windows.length);
    for (const prompt of paragraphs) {
      for (const section of H3.SECTIONS) assert.ok(prompt.includes(`${section}:\n`));
      assert.match(prompt, /^\[\/duration=\d+/);
    }
    assert.match(paragraphs[1], /,\/overlap=/);
    assert.match(paragraphs.at(-1), /,\/new_shot\]/);
  });

  await check('Reference tokens shift only when overlap supplies Picture 1', () => {
    const p = H3.demo();
    const asset = { id: 'smoke-image', kind: 'image', number: 4, name: 'reference.png', description: 'Test image' };
    p.assets.push(asset);
    p.windows.forEach(w => { w.assetIds = [asset.id]; });
    assert.equal(H3.refMap(p, p.windows[0], 0)[0].libraryToken, '<Picture 4>');
    assert.equal(H3.refMap(p, p.windows[0], 0)[0].token, '<Picture 1>');
    assert.equal(H3.refMap(p, p.windows[1], 1)[0].token, '<Picture 2>');
    assert.match(H3.compileSections(p, p.windows[1], 1).subject_definitions, /last overlap frame/);
    assert.equal(H3.refMap(p, p.windows.at(-1), p.windows.length - 1)[0].token, '<Picture 1>');
  });

  await check('Sliding exports one task with the pinned PDD settings', () => {
    const p = H3.demo();
    p.modelType = 'smoke-preset-not-a-real-model';
    const tasks = H3.tasks(p);
    assert.equal(tasks.length, 1);
    assert.equal(tasks[0].model_type, p.modelType);
    assert.equal(tasks[0].multi_prompts_gen_type, 'PW');
    assert.equal(tasks[0].num_inference_steps, 8);
    assert.equal(tasks[0].sample_solver, 'euler');
    assert.equal(tasks[0].guidance_phases, 1);
    assert.equal(tasks[0].force_fps, '24');
    assert.equal(tasks[0].video_length, H3.schedule(p).at(-1).end);
  });

  await check('Independent exports separate tasks without inherited overlap', () => {
    const p = H3.demo();
    p.mode = 'independent';
    const tasks = H3.tasks(p);
    assert.equal(tasks.length, p.windows.length);
    assert.ok(H3.schedule(p).every(row => row.overlap === 0));
    assert.ok(tasks.every(task => task.multi_prompts_gen_type === 'FG' && task.sliding_window_overlap === 0));
    assert.ok(tasks.every(task => !task.prompt.includes('[/duration')));
  });

  await check('Long timeline scaffolding uses finite windows', () => {
    const p = H3.newProject();
    p.windows = H3.scaffold(p, 600, 10, 18);
    assert.ok(p.windows.length > 1);
    assert.ok(H3.schedule(p).every(row => row.span <= p.maxSpan));
  });

  await check('Malformed and incomplete AI proposals do not pass parsing', () => {
    assert.throws(() => H3.parseProposal('not JSON', ['window-a']));
    assert.throws(() => H3.parseProposal('{"windows":[]}', ['window-a']));
    const w = H3.newWindow();
    assert.throws(() => H3.parseProposal(JSON.stringify({windows:[w]}),[w.id]), /unfinished/);
    Object.assign(w,{summary:'[reference generation] An empty room.',detail:'[Shot 1] A locked-off shot of an empty room.',soundscape:'Quiet indoor room tone.'});
    const valid = { windows: [w], subjects: [], notes: [] };
    assert.equal(H3.parseProposal(JSON.stringify(valid), [w.id]).windows[0].id, w.id);
    assert.throws(() => H3.parseProposal(JSON.stringify(valid), ['a-different-window']));
  });

  // Serve only this package on a temporary loopback port. Never submit a job.
  const dataDir=await mkdtemp(join(tmpdir(),'orch3stra-smoke-'));
  const server = createServer({ port: 0, root, dataDir, backendOptions:{mode:'legacy'} });
  server.listen(0, '127.0.0.1');
  try {
    await once(server, 'listening');
    const base = `http://127.0.0.1:${server.address().port}`;
    await check('Bridge serves the app and its JavaScript with appropriate MIME types', async () => {
      for (const name of ['', 'styles.css', 'core.js', 'storage.js', 'providers.js', 'speech-core.js', 'speech-review-core.js', 'speech-quality-core.js', 'speech-quality-ui.js', 'speech-review-ui.js', 'speech-ui.js', 'takes-ui.js', 'direction-ui.js', 'soundscape-ui.js', 'studio-ui.js', 'backend-ui.js', 'sequence-ui.js', 'ai-ui.js', 'progress-core.js', 'progress-ui.js', 'editor-ui.js', 'render-selection-core.js', 'render-selection-ui.js', 'reference-core.js', 'reference-ui.js', 'clinic-core.js', 'film-core.js', 'clinic-ui.js', 'film-ui.js', 'voice-studio.js', 'codex-ui.js', 'scene-core.js', 'doctor-core.js', 'reference-agent-core.js', 'coverage-ui.js', 'scene-ui.js', 'post-ui.js', 'scene-edit-core.js', 'scene-edit-ui.js', 'sound-core.js', 'sound-ui.js', 'workspace-ui.js', 'image-crop-ui.js', 'music-ui.js','app-confirm.js', 'pending-intent.js', 'app.js', 'README.md', 'THIRD_PARTY_NOTICES.md']) {
        const response = await fetch(`${base}/${name}`, { signal: AbortSignal.timeout(5000) });
        assert.equal(response.status, 200, `GET /${name}`);
        if (name.endsWith('.js')) assert.match(response.headers.get('content-type'), /javascript/);
        assert.ok((await response.text()).length > 0);
      }
    });
    await check('Bridge health endpoint returns the expected handshake', async () => {
      const response = await fetch(`${base}/api/health`, { signal: AbortSignal.timeout(5000) });
      const health = await response.json();
      assert.equal(health.app, 'h3-director-bridge');
      assert.equal(typeof health.token, 'string');
      assert.ok(health.token.length > 0);
    });
    await check('Bridge rejects unauthenticated generation without calling a provider', async () => {
      const response = await fetch(`${base}/api/generate`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}',
        signal: AbortSignal.timeout(5000)
      });
      assert.equal(response.status, 403);
      await response.text();
    });
  } finally {
    await new Promise(resolve => { server.close(resolve); server.closeAllConnections(); });
    await Promise.allSettled([server.ai.close(),server.voice.close()]);server.referenceAgent.close();server.sounds.close();await rm(dataDir,{recursive:true,force:true});
  }
  console.log(`\n${checks} smoke checks passed. Browser interactions, live providers, and WanGP rendering were NOT tested.`);
}
main().catch(error => { console.error(`\nFAIL ${error.stack || error.message}`); process.exitCode = 1; });
