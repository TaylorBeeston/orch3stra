/** Observable AI requests owned by Node, independent of an open browser request.
 * API keys remain in memory. Private request/result records are durable, bounded,
 * and never automatically retried after timeout, disconnection, or restart.
 */
import {mkdir, readdir, rm, stat, rename, appendFile, chmod} from 'node:fs/promises';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {atomicJSON, loadJSON, safeID} from './studio-server.mjs';
import {aiError} from './ai-stream.mjs';
const require = createRequire(import.meta.url), {redact} = require('./studio-core.js');
const ACTIVE = new Set(['accepted', 'running']);
const now = () => new Date().toISOString();
const clone = value => JSON.parse(JSON.stringify(value));
function duration(raw, fallback, min, max) {
  if (raw === undefined || raw === '') return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < min || n > max) throw Error(`AI timeout must be between ${min} and ${max} seconds.`);
  return n;
}
export function aiConfiguration(env = process.env) {
  return {timeoutMs: 1000 * duration(env.H3_AI_TIMEOUT_SECONDS, 1200, 30, 3600),
    idleMs: 1000 * duration(env.H3_AI_IDLE_SECONDS, 180, 15, 1800)};
}
function answer(data) {
  if (typeof data.text === 'string') return data.text;
  if (typeof data.output_text === 'string') return data.output_text;
  if (typeof data.choices?.[0]?.message?.content === 'string') return data.choices[0].message.content;
  if (Array.isArray(data.output)) return data.output.flatMap(x => x.content || []).filter(x => x.type === 'output_text').map(x => x.text).join('\n');
  if (Array.isArray(data.content)) return data.content.filter(x => x.type === 'text').map(x => x.text).join('\n');
  return '';
}
export class AIRequests {
  constructor(root, runner, {timeoutMs, idleMs, silent = false, maxHistory = 100, beforeInit = Promise.resolve()} = {}) {
    const defaults = aiConfiguration();
    this.root = join(root, 'ai-requests'); this.logPath = join(root, 'ai-requests.log');
    this.timeoutMs = timeoutMs ?? defaults.timeoutMs; this.idleMs = idleMs ?? defaults.idleMs;
    this.runner = runner; this.silent = silent; this.maxHistory = maxHistory;
    this.jobs = new Map(); this.running = new Map(); this.cleaners = new Map(); this.writes = Promise.resolve();
    this.closed = false; this.beforeInit = beforeInit; this.ready = this.init();
  }
  async init() {
    await this.beforeInit;
    await mkdir(this.root, {recursive: true, mode: 0o700}); await chmod(this.root, 0o700);
    for (const file of await readdir(this.root)) {
      if (!/^[a-zA-Z0-9_-]{1,128}\.json$/.test(file)) continue;
      const job = await loadJSON(join(this.root, file));
      if (!job?.id || !safeID(job.id)) continue;
      this.jobs.set(job.id, job);
      if (ACTIVE.has(job.status)) {
        job.status = 'interrupted'; job.phase = 'interrupted'; job.finishedAt = now();
        job.errorCode = 'AI_SERVER_RESTART';
        job.error = 'Director restarted before this request completed. No automatic retry was made. The provider may have consumed usage; review before requesting another plan.';
        this.event(job, 'interrupted', job.error); await this.save(job);
      }
    }
    await this.prune();
  }
  serialize(fn) {
    const next = this.writes.catch(() => {}).then(fn); this.writes = next; return next;
  }
  clean(job, data) {return (this.cleaners.get(job.id) || redact)(data);}
  save(job) {
    const record = this.clean(job, clone(job));
    return this.serialize(() => atomicJSON(join(this.root, job.id + '.json'), record));
  }
  event(job, phase, message) {
    job.events ||= []; job.events.push({at: now(), phase, message}); job.events = job.events.slice(-200);
  }
  log(job, label) {
    // Do not put prompts, raw model text, provider error bodies or secrets in logs.
    const entry = {at: now(), id: job.id, kind: job.kind, provider: job.provider, model: job.model,
      event: label, phase: job.phase, status: job.status, elapsedSeconds: this.view(job).elapsedSeconds,
      outputCharacters: job.outputCharacters || 0, httpStatus: job.httpStatus ?? null, code: job.errorCode || null};
    const line = JSON.stringify(entry);
    if (!this.silent) console.log('[AI] ' + line);
    this.serialize(async () => {
      try {if ((await stat(this.logPath)).size > 5 * 1024 * 1024) {await rm(this.logPath + '.1', {force: true}); await rename(this.logPath, this.logPath + '.1');}} catch (e) {if (e.code !== 'ENOENT') throw e;}
      await appendFile(this.logPath, line + '\n', {mode: 0o600}); await chmod(this.logPath, 0o600);
    }).catch(() => {job.logWarning = 'Could not write AI event log. Check disk permissions/space.';});
  }
  view(job, detail = false) {
    const seconds = date => date ? Math.max(0, ((job.finishedAt ? Date.parse(job.finishedAt) : Date.now()) - Date.parse(date)) / 1000) : null;
    const {request, context, text, events, fingerprint, ...meta} = job;
    return this.clean(job, {...meta, elapsedSeconds: seconds(job.createdAt),
      secondsSinceData: seconds(job.lastDataAt), secondsSinceOutput: seconds(job.lastOutputAt),
      partialPreview: (text || '').slice(-3000),
      ...(job.status === 'completed' || detail ? {text: text || ''} : {}),
      ...(detail ? {request, context, events: events || [], logPath: this.logPath} : {})});
  }
  async handle(body) {
    await this.ready;
    switch (body.action) {
      case 'start': return {job: await this.start(body.request)};
      case 'list': return {jobs: [...this.jobs.values()].filter(j => !body.projectId || j.projectId === body.projectId)
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt)).map(j => this.view(j)), logPath: this.logPath, timeoutSeconds: this.timeoutMs / 1000, idleSeconds: this.idleMs / 1000};
      case 'get': return {job: this.view(this.get(body.id), !!body.detail)};
      case 'cancel': return {job: await this.cancel(body.id)};
      case 'validation': {
        const job = this.get(body.id);
        if (!['valid', 'invalid'].includes(body.status)) throw Error('Invalid validation status.');
        if (job.status !== 'completed') throw Error('Only completed output can be validated.');
        job.validation = {status: body.status, message: this.clean(job, String(body.message || '').slice(0, 2000)), at: now()};
        await this.save(job); return {saved: true};
      }
      default: throw Error('Unknown AI request action.');
    }
  }
  get(id) {if (!safeID(id) || !this.jobs.has(id)) throw Object.assign(Error('AI request not found on this Director server.'), {status: 404}); return this.jobs.get(id);}
  async start(b) {
    if (this.closed) throw Error('Director is stopping; no AI request was sent.');
    if (!b || !safeID(b.requestId) || !['codex', 'opencode', 'deepseek', 'go'].includes(b.provider)) throw Error('Invalid AI request ID/provider.');
    if (typeof b.model !== 'string' || !b.model || b.model.length > 200) throw Error('Select a planner model.');
    if (typeof b.prompt !== 'string' || !b.prompt.trim() || b.prompt.length > 2 * 1024 * 1024 || typeof b.system !== 'string' || b.system.length > 128 * 1024) throw Error('Invalid or oversized planner prompt.');
    if (b.projectId && !safeID(b.projectId)) throw Error('Invalid project ID.');
    if (JSON.stringify(b.context || {}).length > 2 * 1024 * 1024) throw Error('Planner recovery context is too large; reduce the source script.');
    if (!Array.isArray(b.images || []) || (b.images || []).length > 100) throw Error('Invalid image inputs.');
    const fingerprint = createHash('sha256').update(JSON.stringify({...b, key: undefined})).digest('hex');
    const previous = this.jobs.get(b.requestId);
    if (previous) {
      if (previous.fingerprint !== fingerprint) throw Object.assign(Error('This request ID already belongs to different input; no second request was sent.'), {status: 409});
      return this.view(previous);
    }
    const active = [...this.jobs.values()].filter(j => ACTIVE.has(j.status));
    const duplicate = active.find(j => b.kind === 'pacing' && j.kind === 'pacing' && j.projectId && j.projectId === b.projectId);
    if (duplicate) throw Object.assign(Error('A pacing request is already running for this project. Open AI requests instead of sending another.'), {status: 409, aiRequestId: duplicate.id});
    if (active.length >= 4) throw Object.assign(Error('Four AI requests are already active. Inspect or cancel them first.'), {status: 429});
    const secrets = [b.key, process.env.DEEPSEEK_API_KEY, process.env.OPENCODE_GO_API_KEY, process.env.OPENCODE_SERVER_PASSWORD,
      process.env.H3_STUDIO_PASSWORD, process.env.HF_TOKEN, process.env.H3_WANGP_TOKEN].filter(s => typeof s === 'string' && s.length >= 4);
    const clean = value => {
      const walk = v => typeof v === 'string' ? secrets.reduce((s, key) => s.split(key).join('[credential omitted]'), v)
        : Array.isArray(v) ? v.map(walk) : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, walk(x)])) : v;
      return walk(redact(value));
    };
    this.cleaners.set(b.requestId, clean);
    const job = {id: b.requestId, projectId: b.projectId || null, provider: b.provider, model: clean(b.model),
      kind: ['pacing', 'draft', 'soundscapes', 'reference-images'].includes(b.kind) ? b.kind : 'draft', protocol: b.protocol || 'auto',
      createdAt: now(), status: 'accepted', phase: 'accepted', fingerprint, text: '', outputCharacters: 0,
      timeoutSeconds: this.timeoutMs / 1000, idleSeconds: this.idleMs / 1000,
      request: clean({system: b.system, prompt: b.prompt, images: (b.images || []).map(i => ({label: i.label || 'reference', attached: true}))}),
      context: clean(b.context || {}), events: []};
    this.jobs.set(job.id, job); this.event(job, 'accepted', 'Accepted by Director; no automatic retries.');
    try {await this.save(job);} catch (e) {this.jobs.delete(job.id); this.cleaners.delete(job.id); throw e;}
    this.log(job, 'accepted');
    if (this.closed || !ACTIVE.has(job.status)) {
      if (this.closed && ACTIVE.has(job.status)) {job.status='interrupted';job.phase='interrupted';job.finishedAt=now();job.errorCode='AI_SERVER_STOPPED';job.error='Server stopped before this request was sent. No automatic retry was made.';await this.save(job);}
      return this.view(job);
    }
    // No request/response-socket signal: browser disconnection cannot cancel this job.
    const controller = new AbortController();
    const pending = Promise.resolve().then(() => this.run(job, b, controller));
    this.running.set(job.id, {controller, pending});
    pending.catch(() => {}).finally(() => {this.running.delete(job.id); this.cleaners.delete(job.id); this.prune().catch(() => {});});
    return this.view(job);
  }
  async run(job, input, controller) {
    const signal = controller.signal; let lastSaved = 0, lastLog = Date.now();
    const deadline = setTimeout(() => controller.abort(aiError('AI_TOTAL_TIMEOUT', `Director's ${Math.round(this.timeoutMs / 60000 * 10) / 10}-minute total AI deadline expired. Partial output is retained. No automatic retry was made.`)), this.timeoutMs);
    deadline.unref?.();
    const persistProgress = () => this.save(job).catch(() => {job.logWarning = 'Could not save live diagnostics. Check disk permissions/space.';});
    const progress = update => {
      if (!ACTIVE.has(job.status) || signal.aborted) return;
      if (update.phase && update.phase !== job.phase) {job.phase = update.phase; this.event(job, update.phase, update.phase.replaceAll('_', ' ')); this.log(job, 'phase');}
      for (const k of ['httpStatus', 'providerRequestId', 'usage', 'finishReason', 'receivedBytes']) if (update[k] != null) job[k] = update[k];
      if (update.keepalive || update.receivedBytes != null || update.delta) job.lastDataAt = now();
      if (update.keepalive) job.keepalives = (job.keepalives || 0) + 1;
      if (typeof update.delta === 'string' && update.delta) {
        job.text += update.delta;
        if (job.text.length > 2 * 1024 * 1024) throw aiError('AI_RESPONSE_SIZE', 'Model output exceeded 2 MiB. Partial output is retained.');
        job.outputCharacters = job.text.length; job.lastOutputAt = now(); job.firstOutputAt ||= job.lastOutputAt;
      }
      if (Date.now() - lastSaved > 1000) {lastSaved = Date.now(); persistProgress();}
    };
    const heartbeat = setInterval(() => {
      if (Date.now() - lastLog >= 15_000) {lastLog = Date.now(); this.log(job, 'heartbeat');}
    }, 5000); heartbeat.unref?.();
    try {
      if (signal.aborted) throw signal.reason;
      job.status = 'running'; progress({phase: 'connecting'});
      const aborted = new Promise((_, reject) => signal.addEventListener('abort', () => reject(signal.reason), {once: true}));
      const data = await Promise.race([this.runner(input, signal, progress, {idleMs: this.idleMs}), aborted]);
      if (signal.aborted) throw signal.reason;
      const content = answer(data);
      if (content) job.text = content;
      if (job.text.length > 2 * 1024 * 1024) {job.text=job.text.slice(0,2*1024*1024);throw aiError('AI_RESPONSE_SIZE','Model output exceeded 2 MiB. A diagnostic prefix is retained.');}
      job.outputCharacters = job.text.length;
      job.finishReason = data.choices?.[0]?.finish_reason || data.status || job.finishReason || null;
      job.providerRequestId = data.id || job.providerRequestId || null; job.usage = data.usage || job.usage || null;
      if (job.finishReason === 'length' || data.status === 'incomplete') throw aiError('AI_OUTPUT_LIMIT', 'Provider stopped at its output limit. Partial JSON is retained but not applied. No automatic retry was made.');
      if (!job.text.trim()) throw aiError('AI_EMPTY_OUTPUT', 'Provider returned no usable assistant text. Inspect this request before retrying.');
      job.status = 'completed'; job.phase = 'completed'; this.event(job, 'completed', 'Response received. Creative validation/review is still required.');
    } catch (e) {
      const failure = signal.aborted ? signal.reason : e;
      job.errorCode = failure?.code || failure?.cause?.code || (failure?.name === 'TimeoutError' ? 'AI_TIMEOUT' : 'AI_REQUEST_FAILED');
      job.error = this.clean(job, String(failure?.message || failure || 'AI request failed.').slice(0, 4000));
      if (failure?.httpStatus) job.httpStatus = failure.httpStatus;
      if (failure?.retryAfter) job.retryAfter = String(failure.retryAfter);
      job.status = job.errorCode === 'AI_CANCELLED' ? 'cancelled' : job.errorCode === 'AI_SERVER_STOPPED' ? 'interrupted' : job.errorCode.includes('TIMEOUT') ? 'timed_out' : 'error';
      job.phase = job.status; this.event(job, job.status, job.error);
    } finally {
      clearTimeout(deadline); clearInterval(heartbeat); job.finishedAt = now();
      // Clean the in-memory copy too, before releasing the one-request sanitizer.
      Object.assign(job, this.clean(job, clone(job)));
      this.log(job, 'finished'); try {await this.save(job);} catch {job.logWarning='This result is in memory, but the disk record could not be saved. Download it before restarting; check disk space/permissions.';}
    }
  }
  async cancel(id) {
    const job = this.get(id), running = this.running.get(id);
    if (!running && ACTIVE.has(job.status)) {job.status='cancelled';job.phase='cancelled';job.finishedAt=now();job.errorCode='AI_CANCELLED';job.error='Cancelled before provider dispatch.';await this.save(job);}
    if (running && ACTIVE.has(job.status)) {
      running.controller.abort(aiError('AI_CANCELLED', 'Cancelled by user. No automatic retry was made; provider usage already incurred may still be charged.'));
      await running.pending;
    }
    return this.view(job);
  }
  async prune() {
    const finished = [...this.jobs.values()].filter(j => !ACTIVE.has(j.status) && !this.running.has(j.id)).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    for (const job of finished.slice(this.maxHistory)) {this.jobs.delete(job.id); await rm(join(this.root, job.id + '.json'), {force: true});}
  }
  async close() {
    this.closed = true; await this.ready;
    for (const {controller} of this.running.values()) controller.abort(aiError('AI_SERVER_STOPPED', 'Director server stopped during this AI request. No automatic retry was made.'));
    await Promise.allSettled([...this.running.values()].map(r => r.pending)); await this.writes.catch(() => {});
  }
}
