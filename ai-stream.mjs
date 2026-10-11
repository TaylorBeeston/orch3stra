/** Bounded, dependency-free DeepSeek SSE transport. No fetch/Undici implicit timeouts.
 * The caller owns the total deadline. This module bounds connection and silence,
 * handles SSE comments as transport activity, and never retries a paid request.
 */
import http from 'node:http';
import https from 'node:https';

export function aiError(code, message, extra = {}) {
  return Object.assign(new Error(message), {code, ...extra});
}

export function streamChat({url, headers, body, signal, progress = () => {},
  connectMs = 90_000, idleMs = 180_000, maxBytes = 8 * 1024 * 1024}) {
  return new Promise((resolve, reject) => {
    const target = new URL(url);
    if (!['https:', 'http:'].includes(target.protocol) || target.username || target.password) {
      reject(aiError('AI_URL', 'Invalid provider endpoint.')); return;
    }
    let request, response, settled = false, idleTimer, connectTimer, bytes = 0;
    let buffer = '', eventLines = [], text = '', finishReason = null, usage = null, requestId = null, done = false;
    const abort = () => finish(signal.reason || aiError('AI_CANCELLED', 'Request cancelled.'));
    const clear = () => {clearTimeout(idleTimer); clearTimeout(connectTimer); signal?.removeEventListener('abort', abort);};
    const finish = (error, result) => {
      if (settled) return;
      settled = true; clear();
      if (error) { request?.destroy(); response?.destroy(); reject(error); }
      else { request?.destroy(); response?.destroy(); resolve(result); }
    };
    const touch = () => {
      clearTimeout(idleTimer);
      idleTimer = setTimeout(() => finish(aiError('AI_IDLE_TIMEOUT', `Provider sent no network data for ${Math.round(idleMs / 1000)} seconds. No automatic retry was made.`)), idleMs);
      idleTimer.unref?.();
    };
    const report = (event) => {try {progress(event);} catch (error) {finish(error);}};
    const consume = () => {
      const lines = eventLines; eventLines = [];
      const data = lines.filter(s => s.startsWith('data:')).map(s => s.slice(5).replace(/^ /, '')).join('\n');
      if (!data) return;
      if (data.trim() === '[DONE]') {
        done = true;
        if (!finishReason) throw aiError('AI_STREAM_INCOMPLETE', 'Provider sent DONE without a finish reason. Partial output is retained.');
        finish(null, {id: requestId, choices: [{message: {role: 'assistant', content: text}, finish_reason: finishReason}], usage});
        return;
      }
      let chunk;
      try {chunk = JSON.parse(data);} catch {throw aiError('AI_STREAM_INVALID', 'Provider sent an invalid JSON streaming event. Partial output is retained.');}
      if (chunk.error) throw aiError('AI_PROVIDER_ERROR', typeof chunk.error === 'string' ? chunk.error : chunk.error.message || 'Provider streaming error.');
      if (chunk.id) requestId = String(chunk.id);
      if (chunk.usage) usage = chunk.usage;
      const choice = chunk.choices?.[0];
      if (choice?.finish_reason) finishReason = choice.finish_reason;
      const delta = choice?.delta?.content;
      if (typeof delta === 'string' && delta) text += delta;
      // Never retain or display a provider's internal reasoning channel.
      report({phase: text ? 'streaming' : 'waiting_for_output', delta: typeof delta === 'string' ? delta : '',
        usage, finishReason, providerRequestId: requestId});
    };
    const drain = (final = false) => {
      let index;
      while (!settled && (index = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, index).replace(/\r$/, ''); buffer = buffer.slice(index + 1);
        if (!line) consume(); else if (line.startsWith(':')) report({keepalive: true}); else eventLines.push(line);
      }
      if (final) {if (buffer) eventLines.push(buffer.replace(/\r$/, '')); buffer = ''; consume();}
    };
    if (signal?.aborted) {finish(signal.reason || aiError('AI_CANCELLED', 'Request cancelled.')); return;}
    signal?.addEventListener('abort', abort, {once: true});
    const payload = JSON.stringify({...body, stream: true, stream_options: {include_usage: true}});
    report({phase: 'connecting'});
    const transport = target.protocol === 'https:' ? https : http;
    request = transport.request(target, {method: 'POST', headers: {...headers, Accept: 'text/event-stream',
      'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload)}, agent: false}, res => {
      response = res; clearTimeout(connectTimer); touch();
      const status = res.statusCode || 0;
      requestId = res.headers['x-request-id'] || res.headers['request-id'] || null;
      report({phase: 'waiting_for_output', httpStatus: status, providerRequestId: requestId});
      res.setEncoding('utf8');
      const sse = String(res.headers['content-type'] || '').includes('text/event-stream');
      let fallback = '';
      res.on('data', chunk => {
        if (settled) return;
        try {
          touch(); bytes += Buffer.byteLength(chunk);
          if (bytes > maxBytes) throw aiError('AI_RESPONSE_SIZE', 'Provider response exceeded the safe size limit. Partial output is retained.');
          report({receivedBytes: bytes});
          if (status < 200 || status >= 300 || !sse) fallback += chunk;
          else {buffer += chunk; drain();}
        } catch (e) {finish(e);}
      });
      res.on('aborted', () => finish(aiError('AI_STREAM_CLOSED', 'Provider connection closed before completing the response. Partial output is retained.')));
      res.on('error', e => finish(aiError(e.code || 'AI_NETWORK', e.message)));
      res.on('end', () => {
        if (settled) return;
        try {
          if (status < 200 || status >= 300) {
            let message; try {const d = JSON.parse(fallback); message = typeof d.error === 'string' ? d.error : d.error?.message;} catch {}
            throw aiError('AI_HTTP_' + status, message || `Provider returned HTTP ${status}.`, {httpStatus: status, retryAfter: res.headers['retry-after'] || null});
          }
          if (!sse) {
            let data; try {data = JSON.parse(fallback);} catch {throw aiError('AI_NON_JSON', 'Provider returned neither SSE nor a valid JSON response.');}
            const content = data.choices?.[0]?.message?.content;
            if (typeof content === 'string') report({delta: content, phase: 'streaming', finishReason: data.choices[0].finish_reason, usage: data.usage, providerRequestId: data.id});
            finish(null, data); return;
          }
          drain(true);
          if (!done || !finishReason) throw aiError('AI_STREAM_INCOMPLETE', 'Provider stream ended without a complete finish marker. Partial output is retained; it was not applied.');
          finish(null, {id: requestId, choices: [{message: {role: 'assistant', content: text}, finish_reason: finishReason}], usage});
        } catch (e) {finish(e);}
      });
    });
    connectTimer = setTimeout(() => finish(aiError('AI_CONNECT_TIMEOUT', 'Could not establish the provider connection within the connection deadline.')), connectMs);
    connectTimer.unref?.();
    request.on('socket', socket => {
      const connected = () => {clearTimeout(connectTimer); touch(); report({phase: 'waiting_for_headers'});};
      socket.once(target.protocol === 'https:' ? 'secureConnect' : 'connect', connected);
    });
    request.on('error', e => finish(aiError(e.code || 'AI_NETWORK', e.message)));
    request.end(payload);
  });
}
