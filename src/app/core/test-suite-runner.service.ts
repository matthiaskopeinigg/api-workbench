import { Injectable, NgZone } from '@angular/core';
import { v4 as uuidv4 } from 'uuid';
import { Subject } from 'rxjs';
import type {
  Assertion,
  AssertionResult,
  AssertionStatus,
  CaseRunResult,
  Extraction,
  SnapshotAssertion,
  SnapshotDiffReport,
  SnapshotRecord,
  SuiteRunResult,
  TestCase,
  TestSuiteArtifact,
} from '@models/testing/test-suite';
import { snapshotKey } from '@models/testing/test-suite';
import { CollectionService } from './collection.service';
import { TestArtifactService } from './test-artifact.service';
import { SettingsService } from './settings.service';
import type { Certificate } from '@models/settings';
import type { IpcHttpRequest } from '@models/ipc-http-request';
import { diffJson, diffText } from './json-diff';
import { HttpMethod, type Request as RequestModel } from '@models/request';

const DEFAULT_SNAPSHOT_HEADERS = ['content-type', 'cache-control'];

interface RawResponse {
  status: number;
  statusText?: string;
  headers?: Record<string, string> | Array<{ key: string; value: string }>;
  body?: unknown;
  timeMs?: number;
  size?: number;
}

interface RunOptions {
  fromCaseId?: string;
  onlyCaseId?: string;
}

/**
 * Renderer-side test suite executor. Each case is normalized into the same
 * IPC HTTP shape as a normal "Send", then the response is run through the
 * suite's assertions. Suite-scoped variables propagate forward — earlier
 * cases can extract values used by later ones.
 *
 * Design notes:
 * - We do NOT touch the global environment. Suite variables live in their
 *   own bag; promoting them to the env is an explicit follow-up.
 * - Cases run sequentially. Parallel suites are out of scope for the MVP
 *   (failure ordering and shared-variable semantics get hairy).
 */
@Injectable({ providedIn: 'root' })
export class TestSuiteRunnerService {
  private results$ = new Subject<{ suiteId: string; caseResult: CaseRunResult }>();
  private finished$ = new Subject<SuiteRunResult>();

  constructor(
    private collections: CollectionService,
    private artifacts: TestArtifactService,
    private zone: NgZone,
    private settings: SettingsService,
  ) {}

  onCaseResult() { return this.results$.asObservable(); }
  onFinished() { return this.finished$.asObservable(); }

  /**
   * Accept the current snapshot for a given assertion as the new baseline.
   * Sets a `pendingAccept` flag on the assertion so the next run overwrites
   * the stored baseline with whatever it captures.
   */
  markSnapshotForAccept(suite: TestSuiteArtifact, caseId: string, assertionId: string): void {
    const tc = suite.cases.find((c) => c.id === caseId);
    if (!tc) return;
    for (const a of tc.assertions) {
      if (a.kind === 'snapshot' && a.id === assertionId) a.pendingAccept = true;
    }
  }

  async run(suite: TestSuiteArtifact, opts: RunOptions = {}): Promise<SuiteRunResult> {
    await this.settings.loadSettings();
    const startedAt = Date.now();
    const cases = this.pickCases(suite, opts);
    const variables = new Map<string, string>(suite.variables.map((v) => [v.key, v.value] as [string, string]));
    const caseResults: CaseRunResult[] = [];
    let overall: AssertionStatus = 'pass';

    const allSnapshots = [...this.artifacts.testSuiteSnapshots()];
    const snapshotMap = new Map<string, SnapshotRecord>();
    for (const r of allSnapshots) snapshotMap.set(r.id, r);
    let snapshotsDirty = false;

    for (const tc of cases) {
      if (!tc.enabled) {
        const skipped: CaseRunResult = {
          caseId: tc.id, caseName: tc.name || '(unnamed)',
          status: 'skip',
          durationMs: 0,
          request: { method: '', url: '' },
          response: { status: 0 },
          assertions: [],
          extracted: {},
        };
        caseResults.push(skipped);
        this.zone.run(() => this.results$.next({ suiteId: suite.id, caseResult: skipped }));
        continue;
      }

      const caseResult = await this.runCase(tc, variables, {
        suite,
        snapshotMap,
        markDirty: () => { snapshotsDirty = true; },
      });
      if (suite.regressionMode) applyRegressionFilter(caseResult);
      caseResults.push(caseResult);
      this.zone.run(() => this.results$.next({ suiteId: suite.id, caseResult }));
      if (caseResult.status === 'fail') overall = 'fail';
      else if (caseResult.status === 'warn' && overall === 'pass') overall = 'warn';
    }

    if (snapshotsDirty) {
      const flushed = [...snapshotMap.values()];
      try {
        await this.artifacts.bulkReplace('testSuiteSnapshots', flushed);
      } catch {
      }
    }

    const result: SuiteRunResult = {
      runId: uuidv4(),
      suiteId: suite.id,
      startedAt,
      endedAt: Date.now(),
      status: overall,
      cases: caseResults,
      finalVariables: [...variables.entries()].map(([key, value]) => ({ key, value })),
    };
    this.zone.run(() => this.finished$.next(result));
    return result;
  }

  private pickCases(suite: TestSuiteArtifact, opts: RunOptions): TestCase[] {
    if (opts.onlyCaseId) {
      const c = suite.cases.find((c) => c.id === opts.onlyCaseId);
      return c ? [c] : [];
    }
    if (opts.fromCaseId) {
      const idx = suite.cases.findIndex((c) => c.id === opts.fromCaseId);
      return idx >= 0 ? suite.cases.slice(idx) : [];
    }
    return suite.cases;
  }

  private async runCase(
    tc: TestCase,
    variables: Map<string, string>,
    ctx: SnapshotContext,
  ): Promise<CaseRunResult> {
    const start = Date.now();
    const ipcRequest = this.buildRequest(tc, variables);
    if (!ipcRequest) {
      return {
        caseId: tc.id,
        caseName: tc.name || '(unnamed)',
        status: 'fail',
        durationMs: 0,
        request: { method: '', url: '' },
        response: { status: 0 },
        assertions: [],
        extracted: {},
        errorMessage: 'Could not resolve request (deleted?)',
      };
    }

    let response: RawResponse;
    try {
      response = await window.awElectron.httpRequest(ipcRequest as never) as RawResponse;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return {
        caseId: tc.id,
        caseName: tc.name || '(unnamed)',
        status: 'fail',
        durationMs: Date.now() - start,
        request: this.toRequestSnapshot(ipcRequest),
        response: { status: 0 },
        assertions: [],
        extracted: {},
        errorMessage: msg,
      };
    }

    const assertions: AssertionResult[] = (tc.assertions || []).map((a) =>
      this.evaluateAssertion(a, response, tc, ctx),
    );
    const extracted = this.evaluateExtractions(tc.extracts || [], response);
    for (const [k, v] of Object.entries(extracted)) variables.set(k, v);

    let status: AssertionStatus = 'pass';
    for (const r of assertions) {
      if (r.status === 'fail') { status = 'fail'; break; }
      if (r.status === 'warn' && status === 'pass') status = 'warn';
    }

    return {
      caseId: tc.id,
      caseName: tc.name || '(unnamed)',
      status,
      durationMs: Date.now() - start,
      request: this.toRequestSnapshot(ipcRequest),
      response: this.toResponseSnapshot(response),
      assertions,
      extracted,
    };
  }

  private buildRequest(tc: TestCase, variables: Map<string, string>): IpcHttpRequest | null {
    let method: string;
    let url: string;
    let headersList: Array<{ key: string; value: string }>;
    let body: string | undefined;
    let per: { verifySsl?: boolean; followRedirects?: boolean; useCookies?: boolean } = {};

    if (tc.target.kind === 'inline') {
      method = tc.target.method || 'GET';
      url = applyVars(tc.target.url, variables);
      headersList = (tc.target.headers || []).map((h) => ({ key: h.key, value: applyVars(h.value || '', variables) }));
      body = tc.target.body != null ? applyVars(tc.target.body, variables) : undefined;
    } else {
      const req = this.collections.findRequestById(tc.target.requestId);
      if (!req) return null;
      method = HttpMethod[req.httpMethod] || 'GET';
      url = applyVars(req.url || '', variables);
      headersList = (req.httpHeaders || [])
        .filter((h) => h.enabled !== false && !!h.key)
        .map((h) => ({ key: h.key, value: applyVars(h.value || '', variables) }));
      body = extractBodyString(req, variables);
      per = {
        verifySsl: req.settings?.verifySsl,
        followRedirects: req.settings?.followRedirects,
        useCookies: req.settings?.useCookies,
      };
    }

    const headers: Record<string, string> = {};
    for (const h of headersList) headers[h.key] = h.value;

    if (url && !/^https?:\/\//i.test(url)) url = 'http://' + url;

    let certificate: Certificate | undefined;
    try {
      certificate = this.settings.getClientCertificateForHost(new URL(url).hostname);
    } catch {
      certificate = undefined;
    }

    return this.settings.applyGlobalNetworkToIpc(
      { method, url, headers, params: {}, body, certificate, followRedirects: true, timeoutMs: 30000 },
      per,
    );
  }

  private evaluateAssertion(
    a: Assertion,
    response: RawResponse,
    tc: TestCase,
    ctx: SnapshotContext,
  ): AssertionResult {
    switch (a.kind) {
      case 'status': {
        const code = response.status;
        const ok =
          typeof a.expected === 'number'
            ? code === a.expected
            : matchRange(code, a.expected);
        return {
          kind: 'status',
          label: `Status ${a.expected}`,
          status: ok ? 'pass' : 'fail',
          expected: String(a.expected),
          actual: String(code),
        };
      }
      case 'latency': {
        const ms = response.timeMs ?? 0;
        if (ms > a.failAboveMs) {
          return { kind: 'latency', label: `Latency ≤ ${a.failAboveMs} ms`, status: 'fail', actual: `${ms} ms` };
        }
        if (a.warnAboveMs && ms > a.warnAboveMs) {
          return { kind: 'latency', label: `Latency ≤ ${a.warnAboveMs} ms (warn)`, status: 'warn', actual: `${ms} ms` };
        }
        return { kind: 'latency', label: `Latency ≤ ${a.failAboveMs} ms`, status: 'pass', actual: `${ms} ms` };
      }
      case 'header': {
        const headerMap = normalizeHeaders(response.headers);
        const actual = headerMap[a.name.toLowerCase()];
        let pass = false;
        switch (a.op) {
          case 'exists': pass = actual != null; break;
          case 'equals': pass = actual === a.value; break;
          case 'contains': pass = (actual || '').includes(a.value || ''); break;
          case 'regex': try { pass = new RegExp(a.value || '').test(actual || ''); } catch { pass = false; } break;
        }
        return {
          kind: 'header',
          label: `Header ${a.name} ${a.op}${a.value ? ` "${a.value}"` : ''}`,
          status: pass ? 'pass' : 'fail',
          expected: a.value,
          actual,
        };
      }
      case 'body': {
        const text = bodyAsText(response.body);
        let actual: string | undefined = text;
        let pass = false;
        try {
          if (a.op === 'jsonpath-equals' || a.op === 'jsonpath-truthy') {
            const json = parseJsonSafe(text);
            const v = jsonPathLookup(json, a.path);
            actual = v == null ? '(undefined)' : (typeof v === 'string' ? v : JSON.stringify(v));
            pass = a.op === 'jsonpath-truthy' ? !!v : actual === (a.value ?? '');
          } else if (a.op === 'truthy') {
            pass = !!text;
          } else if (a.op === 'falsy') {
            pass = !text;
          } else if (a.op === 'contains') {
            pass = text.includes(a.value || '');
          } else if (a.op === 'regex') {
            pass = new RegExp(a.value || '').test(text);
          } else if (a.op === 'equals') {
            pass = text === (a.value ?? '');
          }
        } catch (err) {
          return {
            kind: 'body',
            label: `Body ${a.op}${a.path ? ` (${a.path})` : ''}`,
            status: 'fail',
            actual,
            message: err instanceof Error ? err.message : String(err),
          };
        }
        return {
          kind: 'body',
          label: `Body ${a.op}${a.path ? ` (${a.path})` : ''}`,
          status: pass ? 'pass' : 'fail',
          expected: a.value,
          actual,
        };
      }
      case 'snapshot': {
        return this.evaluateSnapshot(a, response, tc, ctx);
      }
    }
  }

  private evaluateSnapshot(
    a: SnapshotAssertion,
    response: RawResponse,
    tc: TestCase,
    ctx: SnapshotContext,
  ): AssertionResult {
    const key = snapshotKey(ctx.suite.id, tc.id, a.id);
    const existing = ctx.snapshotMap.get(key);
    const captured = captureSnapshot(ctx.suite, tc, a, response);

    if (!existing || a.pendingAccept) {
      ctx.snapshotMap.set(key, captured);
      ctx.markDirty();
      a.pendingAccept = false;
      return {
        kind: 'snapshot',
        assertionId: a.id,
        label: 'Snapshot baseline',
        status: 'warn',
        message: existing ? 'Baseline re-accepted from this run' : 'Baseline captured on first run',
        snapshotDiff: { kind: 'baseline-captured', summary: 'Baseline captured', fields: [] },
      };
    }

    const diff = buildSnapshotDiff(existing, captured, a);
    if (diff.kind === 'match') {
      return {
        kind: 'snapshot',
        assertionId: a.id,
        label: 'Snapshot matches baseline',
        status: 'pass',
        snapshotDiff: diff,
      };
    }
    return {
      kind: 'snapshot',
      assertionId: a.id,
      label: 'Snapshot drift detected',
      status: 'fail',
      message: diff.summary,
      snapshotDiff: diff,
    };
  }

  private evaluateExtractions(extracts: Extraction[], response: RawResponse): Record<string, string> {
    const out: Record<string, string> = {};
    if (!extracts.length) return out;
    const text = bodyAsText(response.body);
    const headerMap = normalizeHeaders(response.headers);
    for (const ex of extracts) {
      try {
        if (ex.source.startsWith('header:')) {
          const name = ex.source.slice('header:'.length).toLowerCase();
          const v = headerMap[name];
          if (v != null) out[ex.as] = v;
          continue;
        }
        const json = parseJsonSafe(text);
        const v = jsonPathLookup(json, ex.source);
        if (v == null) continue;
        out[ex.as] = typeof v === 'string' ? v : JSON.stringify(v);
      } catch {
      }
    }
    return out;
  }

  private toRequestSnapshot(ipcRequest: IpcHttpRequest) {
    const body = typeof ipcRequest.body === 'string' ? ipcRequest.body : undefined;
    return {
      method: ipcRequest.method,
      url: ipcRequest.url,
      headers: Object.entries(ipcRequest.headers).map(([key, value]) => ({ key, value })),
      body,
    };
  }

  private toResponseSnapshot(r: RawResponse) {
    return {
      status: r.status,
      statusText: r.statusText,
      headers: Object.entries(normalizeHeaders(r.headers)).map(([key, value]) => ({ key, value })),
      body: bodyAsText(r.body),
      timeMs: r.timeMs,
    };
  }
}

function applyVars(input: string, vars: Map<string, string>): string {
  if (!input) return input;
  return input.replace(/\{\{\s*([\w.-]+)\s*\}\}/g, (full, name) => {
    const v = vars.get(name);
    return v == null ? full : v;
  });
}

function extractBodyString(req: RequestModel, vars: Map<string, string>): string | undefined {
  if (req.body && typeof req.body === 'object' && typeof req.body.raw === 'string') {
    return applyVars(req.body.raw, vars);
  }
  if (typeof req.requestBody === 'string' && req.requestBody) return applyVars(req.requestBody, vars);
  return undefined;
}

function matchRange(code: number, range: string): boolean {
  if (!range || range.length !== 3 || range[1] !== 'x' || range[2] !== 'x') return false;
  const first = Number(range[0]);
  return Math.floor(code / 100) === first;
}

function normalizeHeaders(h: RawResponse['headers']): Record<string, string> {
  if (!h) return {};
  if (Array.isArray(h)) {
    const out: Record<string, string> = {};
    for (const row of h) if (row && row.key) out[row.key.toLowerCase()] = row.value;
    return out;
  }
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(h)) out[k.toLowerCase()] = String(v);
  return out;
}

function bodyAsText(body: unknown): string {
  if (body == null) return '';
  if (typeof body === 'string') return body;
  try { return JSON.stringify(body); } catch { return String(body); }
}

function parseJsonSafe(text: string): unknown {
  if (!text) return null;
  try { return JSON.parse(text); } catch { return null; }
}

/**
 * Tiny JSON-path subset: dot-paths only ($.foo.bar.0). No filters, no
 * recursive descent — covers the common case for header/token plucking
 * without dragging in a JSONPath dependency.
 */
function jsonPathLookup(value: unknown, path: string): unknown {
  if (!path) return value;
  let p = path.trim();
  if (p.startsWith('$.')) p = p.slice(2);
  else if (p.startsWith('$')) p = p.slice(1);
  if (!p) return value;
  const segments = p.split('.').flatMap((seg) => seg.split('[').map((s) => s.replace(/\]$/, '')));
  let cur: unknown = value;
  for (const seg of segments) {
    if (cur == null || seg === '') continue;
    if (Array.isArray(cur) && /^\d+$/.test(seg)) cur = cur[Number(seg)];
    else if (typeof cur === 'object') cur = (cur as Record<string, unknown>)[seg];
    else return undefined;
  }
  return cur;
}

interface SnapshotContext {
  suite: TestSuiteArtifact;
  snapshotMap: Map<string, SnapshotRecord>;
  markDirty: () => void;
}

function captureSnapshot(
  suite: TestSuiteArtifact,
  tc: TestCase,
  a: SnapshotAssertion,
  response: RawResponse,
): SnapshotRecord {
  const body = bodyAsText(response.body);
  const parsed = parseJsonSafe(body);
  const bodyIsJson = parsed !== null || body.trim().startsWith('{') || body.trim().startsWith('[');
  const headerMap = normalizeHeaders(response.headers);
  const include = (a.includeHeaders ?? DEFAULT_SNAPSHOT_HEADERS).map((h) => h.toLowerCase());
  const headers = include
    .filter((h) => headerMap[h] != null)
    .map((h) => ({ key: h, value: headerMap[h] }));
  const now = Date.now();
  return {
    id: snapshotKey(suite.id, tc.id, a.id),
    title: `${suite.title} / ${tc.name || '(unnamed)'} #${a.id.slice(0, 6)}`,
    suiteId: suite.id,
    caseId: tc.id,
    assertionId: a.id,
    capturedAt: now,
    status: response.status ?? 0,
    headers,
    body,
    bodyIsJson,
    updatedAt: now,
  };
}

function buildSnapshotDiff(
  baseline: SnapshotRecord,
  current: SnapshotRecord,
  a: SnapshotAssertion,
): SnapshotDiffReport {
  const fields = [] as SnapshotDiffReport['fields'];

  if ((a.matchStatus ?? true) && baseline.status !== current.status) {
    fields.push({
      path: 'status',
      change: 'changed',
      expected: String(baseline.status),
      actual: String(current.status),
    });
  }

  const base = new Map(baseline.headers.map((h) => [h.key.toLowerCase(), h.value] as const));
  const cur = new Map(current.headers.map((h) => [h.key.toLowerCase(), h.value] as const));
  const headerKeys = new Set([...base.keys(), ...cur.keys()]);
  for (const k of headerKeys) {
    const b = base.get(k);
    const c = cur.get(k);
    if (b === c) continue;
    if (b == null) fields.push({ path: `header:${k}`, change: 'added', actual: c });
    else if (c == null) fields.push({ path: `header:${k}`, change: 'removed', expected: b });
    else fields.push({ path: `header:${k}`, change: 'changed', expected: b, actual: c });
  }

  if (baseline.bodyIsJson && current.bodyIsJson) {
    const parsedBase = parseJsonSafe(baseline.body);
    const parsedCur = parseJsonSafe(current.body);
    fields.push(...diffJson(parsedBase, parsedCur, { ignorePaths: a.ignorePaths }));
  } else if (baseline.body !== current.body) {
    fields.push(...diffText('$body', baseline.body, current.body));
  }

  if (!fields.length) {
    return { kind: 'match', summary: 'Response matches baseline', fields: [] };
  }

  const added = fields.filter((f) => f.change === 'added').length;
  const removed = fields.filter((f) => f.change === 'removed').length;
  const changed = fields.filter((f) => f.change === 'changed').length;
  const parts: string[] = [];
  if (changed) parts.push(`${changed} changed`);
  if (added) parts.push(`${added} added`);
  if (removed) parts.push(`${removed} removed`);
  return {
    kind: 'drift',
    summary: parts.length ? parts.join(', ') : `${fields.length} differences`,
    fields,
  };
}

/**
 * Regression mode: only snapshot assertions drive real pass/fail. Everything
 * else is demoted to "info" (rendered as warn) so the user sees their state
 * but overall status is not polluted by pre-existing assertion failures.
 */
function applyRegressionFilter(caseResult: CaseRunResult): void {
  let hasSnapshotFail = false;
  let hasSnapshotWarn = false;
  let hasSnapshotPass = false;
  for (const r of caseResult.assertions) {
    if (r.kind === 'snapshot') {
      if (r.status === 'fail') hasSnapshotFail = true;
      else if (r.status === 'warn') hasSnapshotWarn = true;
      else if (r.status === 'pass') hasSnapshotPass = true;
    } else if (r.status === 'fail' || r.status === 'warn') {
      r.status = 'warn';
      r.message = `${r.message ?? ''} (ignored in regression mode)`.trim();
    }
  }
  if (hasSnapshotFail) caseResult.status = 'fail';
  else if (hasSnapshotWarn) caseResult.status = 'warn';
  else if (hasSnapshotPass) caseResult.status = 'pass';
  // Else leave it (no snapshots → no regression signal).
}
