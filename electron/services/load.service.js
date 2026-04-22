const { randomUUID } = require('crypto');
const { handleHttpRequest } = require('./http.service');
const { logError, logInfo } = require('./logger.service');

/**
 * In-process load test engine. Each run drives N "virtual users" (VUs)
 * concurrently against a sequence of HTTP request descriptors, streams
 * progress to listeners on a fixed cadence, and produces a final summary
 * with percentile latencies.
 *
 * Notes on the design:
 * - We run requests inside the renderer's existing HTTP service so cookies,
 *   proxy, and HTTP/2 negotiation behave identically to a "Send" click.
 * - We deliberately skip Node `worker_threads` for the MVP. The bottleneck
 *   for typical user-facing loads (≤500 concurrent requests against a
 *   localhost or LAN endpoint) is socket / event-loop scheduling rather
 *   than CPU. If a future use case demands true parallelism, swap the
 *   per-VU loop for a worker pool — the public API doesn't change.
 * - Percentiles use a sorted ring buffer of recent samples. For the live
 *   view we keep the most recent 5 000 latencies (~80 KB) and report
 *   percentiles over that window. The full final summary uses every sample.
 */

const PROGRESS_INTERVAL_MS = 250;
const RECENT_WINDOW = 5000;
const SLOWEST_KEEP = 10;
const ERROR_KEEP = 10;

const runs = new Map(); 

/**
 * Listener callback signature:
 *   ({ runId, status, summary, point, activeVus }) => void   (progress)
 *   (LoadRunResult) => void                                  (done)
 */
function start(config, listeners = {}) {
  const runId = randomUUID();
  const handle = createRunHandle(runId, config, listeners);
  runs.set(runId, handle);

  setImmediate(() => {
    handle.run().catch((err) => {
      logError('Load run crashed', err);
      handle.fail(err);
    });
  });

  return runId;
}

function cancel(runId) {
  const h = runs.get(runId);
  if (!h) return false;
  h.cancel();
  return true;
}

function status(runId) {
  const h = runs.get(runId);
  if (!h) return null;
  return h.snapshot();
}

function createRunHandle(runId, rawConfig, listeners) {
  const config = normalizeConfig(rawConfig);
  const startedAt = Date.now();

  let activeVus = 0;
  let cancelled = false;
  let runStatus = 'running';
  let finalized = false;

  const samples = []; 
  const recent = []; 
  let lastTickAt = startedAt;
  let lastTickSamples = 0;
  const series = [];
  const statusBuckets = Object.create(null);
  let totalSucceeded = 0;
  let totalFailed = 0;
  let totalRequests = 0;

  let tokens = config.rpsCap || 0;
  let lastTokenRefill = Date.now();

  const progressTimer = setInterval(() => emitProgress(), PROGRESS_INTERVAL_MS);

  function emitProgress() {
    const now = Date.now();
    const dtSec = Math.max((now - lastTickAt) / 1000, 0.001);
    const sinceLastTickSamples = totalRequests - lastTickSamples;
    const tickRps = sinceLastTickSamples / dtSec;
    const tickErrors = countErrorsSince(lastTickSamples);
    const point = {
      t: now,
      rps: round1(tickRps),
      errors: tickErrors,
      p50: percentile(recent, 50),
      p95: percentile(recent, 95),
    };
    series.push(point);
    if (series.length > 800) series.shift();
    lastTickAt = now;
    lastTickSamples = totalRequests;
    listeners.onProgress && listeners.onProgress({
      runId,
      status: runStatus,
      startedAt,
      summary: buildSummary(),
      point,
      activeVus,
    });
  }

  function countErrorsSince(prevTotal) {
    if (samples.length === 0) return 0;
    let errs = 0;
    for (let i = prevTotal; i < samples.length; i++) {
      const s = samples[i];
      if (!s) break;
      if (s.errorMessage || s.status >= 400 || s.status === 0) errs++;
    }
    return errs;
  }

  function buildSummary() {
    const elapsedSec = (Date.now() - startedAt) / 1000;
    const all = recent;
    return {
      total: totalRequests,
      successful: totalSucceeded,
      failed: totalFailed,
      statusBuckets: { ...statusBuckets },
      p50: percentile(all, 50),
      p90: percentile(all, 90),
      p95: percentile(all, 95),
      p99: percentile(all, 99),
      meanMs: mean(all),
      rps: elapsedSec > 0 ? round1(totalRequests / elapsedSec) : 0,
      elapsedSec: round1(elapsedSec),
    };
  }

  /** Acquire one RPS token; returns true once the bucket releases one. */
  async function acquireRpsToken() {
    if (!config.rpsCap || config.rpsCap <= 0) return true;
    while (true) {
      const now = Date.now();
      const dt = (now - lastTokenRefill) / 1000;
      lastTokenRefill = now;
      tokens = Math.min(config.rpsCap, tokens + dt * config.rpsCap);
      if (tokens >= 1) {
        tokens -= 1;
        return true;
      }
      const waitMs = Math.max(20, ((1 - tokens) / config.rpsCap) * 1000);
      await sleep(Math.min(waitMs, 200));
      if (cancelled || runStatus !== 'running') return false;
    }
  }

  /** Run a single virtual user loop until cancelled / iterations exhausted. */
  async function runVu(vuId) {
    let iter = 0;
    while (true) {
      if (cancelled) return;
      if (config.iterations && totalRequests >= config.iterations * config.targets.length) return;
      if (config.durationSec && (Date.now() - startedAt) / 1000 >= config.durationSec) return;
      if (config.targets.length === 0) return;

      iter++;
      for (let ti = 0; ti < config.targets.length; ti++) {
        if (cancelled) return;
        const target = config.targets[ti];
        const acquired = await acquireRpsToken();
        if (!acquired) return;
        const sample = await runOnce(target, vuId, iter, ti);
        recordSample(sample);
      }
      if (config.thinkMs > 0) await sleep(config.thinkMs);
    }
  }

  async function runOnce(target, vuId, iter, targetIndex) {
    const start = Date.now();
    try {
      const result = await handleHttpRequest(toIpcRequest(target));
      const durationMs = result.timeMs ?? (Date.now() - start);
      const status = result.status || 0;
      const responseBytes = result.size || 0;
      const errorMessage = status === 0
        ? (result.body && result.body.message) || 'Network Error'
        : undefined;
      return {
        iteration: iter, vu: vuId, targetIndex,
        status, startedAt: start, durationMs,
        errorMessage, responseBytes,
      };
    } catch (err) {
      return {
        iteration: iter, vu: vuId, targetIndex,
        status: 0, startedAt: start, durationMs: Date.now() - start,
        errorMessage: err && err.message || String(err), responseBytes: 0,
      };
    }
  }

  function recordSample(s) {
    samples.push(s);
    totalRequests++;
    const bucket = s.errorMessage ? 'error' : String(s.status);
    statusBuckets[bucket] = (statusBuckets[bucket] || 0) + 1;
    if (s.errorMessage || s.status >= 400 || s.status === 0) totalFailed++;
    else totalSucceeded++;

    insertSorted(recent, s.durationMs);
    if (recent.length > RECENT_WINDOW) recent.shift();
  }

  /**
   * Ramp up VUs linearly over rampUpSec. Returns once all VUs have been
   * launched. Each launched VU runs its loop concurrently.
   */
  async function rampUp() {
    const total = config.vus;
    const rampMs = Math.max(0, config.rampUpSec * 1000);
    const stepMs = total > 0 ? rampMs / total : 0;
    const tasks = [];
    for (let v = 0; v < total; v++) {
      if (cancelled) break;
      activeVus++;
      tasks.push(runVu(v + 1));
      if (stepMs > 0) await sleep(stepMs);
    }
    await Promise.all(tasks);
    activeVus = 0;
  }

  function snapshot() {
    return {
      runId,
      status: runStatus,
      startedAt,
      summary: buildSummary(),
      point: series[series.length - 1] || null,
      activeVus,
    };
  }

  return {
    config,
    snapshot,
    cancel: () => {
      if (cancelled) return;
      cancelled = true;
      runStatus = 'cancelled';
      finalize();
    },
    fail: (err) => {
      cancelled = true;
      runStatus = 'error';
      finalize(err && err.message || 'Run failed');
    },
    async run() {
      logInfo(`Load run ${runId} starting (vus=${config.vus}, dur=${config.durationSec}s, iters=${config.iterations})`);
      try {
        await rampUp();
      } finally {
        if (runStatus === 'running') runStatus = cancelled ? 'cancelled' : 'finished';
        finalize();
      }
    },
  };

  function finalize(errorMessage) {
    if (finalized) return;
    finalized = true;
    clearInterval(progressTimer);
    const endedAt = Date.now();
    const slowest = [...samples].sort((a, b) => b.durationMs - a.durationMs).slice(0, SLOWEST_KEEP);
    const errorMap = new Map();
    for (const s of samples) {
      if (!s.errorMessage && s.status > 0 && s.status < 400) continue;
      const key = s.errorMessage || `HTTP ${s.status}`;
      const prev = errorMap.get(key);
      if (prev) prev.count++;
      else errorMap.set(key, { message: key, count: 1, sample: s });
      if (errorMap.size > 256) break;
    }
    const errors = [...errorMap.values()].sort((a, b) => b.count - a.count).slice(0, ERROR_KEEP);

    const result = {
      runId,
      status: runStatus,
      startedAt,
      endedAt,
      config,
      summary: buildSummary(),
      series,
      slowest,
      errors,
      errorMessage,
    };
    listeners.onDone && listeners.onDone(result);
    runs.delete(runId);
  }
}

function toIpcRequest(target) {
  if (target == null) {
    throw new Error('Load target is null');
  }
  // Renderer sends full IpcHttpRequest (mTLS, proxy, SSL, etc.); `kind` is absent.
  if (target.kind === 'inline') {
    const headers = {};
    for (const h of target.headers || []) {
      if (h && h.key) headers[h.key] = h.value || '';
    }
    return {
      method: target.method || 'GET',
      url: target.url,
      headers,
      params: {},
      body: target.body || undefined,
      followRedirects: true,
      timeoutMs: 30000,
    };
  }
  if (target.url && target.method) {
    return {
      ...target,
      headers: target.headers && typeof target.headers === 'object' && !Array.isArray(target.headers)
        ? target.headers
        : {},
      params: target.params && typeof target.params === 'object' && !Array.isArray(target.params)
        ? target.params
        : {},
    };
  }
  throw new Error(`Unsupported load target: ${String(target && target.kind)}`);
}

function normalizeConfig(c) {
  return {
    targets: Array.isArray(c?.targets) ? c.targets : [],
    vus: Math.max(1, Math.min(500, Number(c?.vus) || 1)),
    durationSec: c?.durationSec == null ? null : Math.max(1, Number(c.durationSec)),
    iterations: c?.iterations == null ? null : Math.max(1, Number(c.iterations)),
    rampUpSec: Math.max(0, Number(c?.rampUpSec) || 0),
    rpsCap: c?.rpsCap == null ? null : Math.max(1, Number(c.rpsCap)),
    thinkMs: Math.max(0, Number(c?.thinkMs) || 0),
  };
}

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

function insertSorted(arr, value) {
  let lo = 0, hi = arr.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (arr[mid] < value) lo = mid + 1; else hi = mid;
  }
  arr.splice(lo, 0, value);
}

function percentile(sortedAsc, p) {
  if (!sortedAsc.length) return 0;
  const idx = Math.min(sortedAsc.length - 1, Math.max(0, Math.ceil((p / 100) * sortedAsc.length) - 1));
  return Math.round(sortedAsc[idx]);
}

function mean(arr) {
  if (!arr.length) return 0;
  let s = 0; for (const v of arr) s += v; return Math.round(s / arr.length);
}

function round1(v) { return Math.round(v * 10) / 10; }

module.exports = { start, cancel, status };
