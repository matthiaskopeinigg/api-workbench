import { Injectable, NgZone } from '@angular/core';
import { v4 as uuidv4 } from 'uuid';
import { Subject } from 'rxjs';

import { CollectionService } from '@core/collection/collection.service';
import { SettingsService } from '@core/settings/settings.service';
import { EnvironmentsService } from '@core/environments/environments.service';
import { buildWorkspaceVariableMap } from '@core/placeholders/env-substitute';
import { applyDynamicPlaceholders } from '@core/placeholders/dynamic-placeholders';
import type { Certificate } from '@models/settings';
import type { IpcHttpRequest } from '@models/ipc-http-request';
import { HttpMethod, type Request as RequestModel } from '@models/request';
import type {
  AssertNode,
  BranchNode,
  DelayNode,
  FlowArtifact,
  FlowEdge,
  FlowNode,
  FlowNodeRunResult,
  FlowNodeStatus,
  FlowRunResult,
  RequestNode,
  SetVarNode,
  TerminateNode,
  TransformNode,
} from '@models/testing/flow';

interface RawResponse {
  status: number;
  statusText?: string;
  headers?: Record<string, string> | Array<{ key: string; value: string }>;
  body?: unknown;
  timeMs?: number;
}

const METHOD_LABELS: Record<number, string> = {
  [HttpMethod.GET]: 'GET',
  [HttpMethod.POST]: 'POST',
  [HttpMethod.PUT]: 'PUT',
  [HttpMethod.DELETE]: 'DELETE',
  [HttpMethod.PATCH]: 'PATCH',
  [HttpMethod.HEAD]: 'HEAD',
  [HttpMethod.OPTIONS]: 'OPTIONS',
};

/**
 * Executes a FlowArtifact by walking from the Start node along its outbound
 * edges. For the MVP we run each reachable path sequentially; support for
 * fan-out parallel branches can come later without changing the public API.
 *
 * Design constraints:
 *  - Transform / branch / assert expressions run inside `Function(...)` in
 *    the renderer. We deliberately don't introduce a sandboxed evaluator;
 *    flows edit their own process's context only and the user already writes
 *    their own scripts elsewhere in the app.
 *  - Variables persist across a run but are cleared between runs.
 *  - We emit per-node status events so the canvas can light up live.
 */
@Injectable({ providedIn: 'root' })
export class FlowExecutorService {
  private step$ = new Subject<{ flowId: string; step: FlowNodeRunResult }>();
  private done$ = new Subject<FlowRunResult>();
  private cancelled = new Set<string>();

  constructor(
    private collections: CollectionService,
    private zone: NgZone,
    private settings: SettingsService,
    private environments: EnvironmentsService,
  ) {}

  onStep() { return this.step$.asObservable(); }
  onDone() { return this.done$.asObservable(); }

  cancel(flowId: string): void { this.cancelled.add(flowId); }

  async run(
    flow: FlowArtifact,
    runOptions?: { environmentId?: string | null },
  ): Promise<FlowRunResult> {
    await this.settings.loadSettings();
    await this.environments.loadEnvironments();
    this.cancelled.delete(flow.id);
    const runId = uuidv4();
    const startedAt = Date.now();
    const steps: FlowNodeRunResult[] = [];
    const varMap = buildWorkspaceVariableMap(this.environments, {
      environmentId:
        runOptions?.environmentId == null || runOptions?.environmentId === ''
          ? undefined
          : runOptions.environmentId,
    });
    const variables: Record<string, unknown> = {};
    for (const [k, v] of varMap) {
      variables[k] = v;
    }
    const byId = new Map(flow.nodes.map((n) => [n.id, n] as const));
    const outgoing = (nodeId: string, port: FlowEdge['fromPort']) =>
      flow.edges.filter((e) => e.fromNodeId === nodeId && e.fromPort === port);

    const start = flow.nodes.find((n) => n.kind === 'start');
    if (!start) {
      return this.finishWith(runId, flow.id, startedAt, steps, variables, 'failure');
    }

    let outcome: 'success' | 'failure' | 'cancelled' = 'success';
    let input: unknown = undefined;
    let current: FlowNode | undefined = start;
    let lastPort: FlowEdge['fromPort'] = 'out';

    while (current) {
      if (this.cancelled.has(flow.id)) { outcome = 'cancelled'; break; }

      const runResult = await this.runNode(current, input, variables);
      steps.push(runResult);
      this.zone.run(() => this.step$.next({ flowId: flow.id, step: runResult }));

      if (runResult.status === 'failed') { outcome = 'failure'; break; }

      lastPort = portFor(current, runResult);

      if (current.kind === 'terminate') {
        outcome = (current as TerminateNode).outcome === 'failure' ? 'failure' : 'success';
        break;
      }

      input = runResult.output;
      const next = outgoing(current.id, lastPort)[0];
      if (!next) break;
      current = byId.get(next.toNodeId);
    }

    return this.finishWith(runId, flow.id, startedAt, steps, variables, outcome);
  }

  private async runNode(
    node: FlowNode,
    input: unknown,
    vars: Record<string, unknown>,
  ): Promise<FlowNodeRunResult> {
    const started = Date.now();
    const base: FlowNodeRunResult = {
      nodeId: node.id,
      status: 'running',
      startedAt: started,
      durationMs: 0,
      input,
    };
    try {
      switch (node.kind) {
        case 'start':
          return { ...base, status: 'success', durationMs: 0, output: input };
        case 'request':
          return await this.runRequest(node, base, vars);
        case 'transform':
          return this.runTransform(node, base, vars);
        case 'branch':
          return this.runBranch(node, base, vars);
        case 'delay':
          return await this.runDelay(node, base);
        case 'set-var':
          return this.runSetVar(node, base, vars);
        case 'assert':
          return this.runAssert(node, base, vars);
        case 'terminate':
          return { ...base, status: 'success', durationMs: Date.now() - started, output: input };
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { ...base, status: 'failed', durationMs: Date.now() - started, message: msg };
    }
  }

  private async runRequest(node: RequestNode, base: FlowNodeRunResult, vars: Record<string, unknown>): Promise<FlowNodeRunResult> {
    const ipcReq = this.buildRequest(node, vars);
    if (!ipcReq) {
      return { ...base, status: 'failed', durationMs: Date.now() - base.startedAt, message: 'Could not resolve request (deleted?)' };
    }
    const response = await window.awElectron.httpRequest(ipcReq as never) as RawResponse;
    return {
      ...base,
      status: 'success',
      durationMs: Date.now() - base.startedAt,
      output: { status: response.status, body: response.body, headers: response.headers },
      message: `${response.status} · ${response.timeMs ?? (Date.now() - base.startedAt)} ms`,
    };
  }

  private runTransform(node: TransformNode, base: FlowNodeRunResult, vars: Record<string, unknown>): FlowNodeRunResult {
    const fn = new Function('input', 'vars', `${node.code}; return typeof output !== 'undefined' ? output : input;`);
    const output = fn(base.input, vars);
    return { ...base, status: 'success', durationMs: Date.now() - base.startedAt, output };
  }

  private runBranch(node: BranchNode, base: FlowNodeRunResult, vars: Record<string, unknown>): FlowNodeRunResult {
    const fn = new Function('input', 'vars', `return (${node.expression});`);
    const truthy = !!fn(base.input, vars);
    return {
      ...base,
      status: 'success',
      durationMs: Date.now() - base.startedAt,
      output: base.input,
      message: truthy ? 'true' : 'false',
    };
  }

  private async runDelay(node: DelayNode, base: FlowNodeRunResult): Promise<FlowNodeRunResult> {
    await new Promise((r) => setTimeout(r, Math.max(0, node.ms)));
    return { ...base, status: 'success', durationMs: Date.now() - base.startedAt, output: base.input };
  }

  private runSetVar(node: SetVarNode, base: FlowNodeRunResult, vars: Record<string, unknown>): FlowNodeRunResult {
    const fn = new Function('input', 'vars', `return (${node.expression});`);
    const value = fn(base.input, vars);
    vars[node.varName] = value;
    return { ...base, status: 'success', durationMs: Date.now() - base.startedAt, output: base.input, message: `${node.varName} = ${asPreview(value)}` };
  }

  private runAssert(node: AssertNode, base: FlowNodeRunResult, vars: Record<string, unknown>): FlowNodeRunResult {
    const fn = new Function('input', 'vars', `return (${node.expression});`);
    const ok = !!fn(base.input, vars);
    if (!ok) {
      return { ...base, status: 'failed', durationMs: Date.now() - base.startedAt, message: node.message || `Assertion failed: ${node.expression}` };
    }
    return { ...base, status: 'success', durationMs: Date.now() - base.startedAt, output: base.input };
  }

  private buildRequest(node: RequestNode, vars: Record<string, unknown>): IpcHttpRequest | null {
    let method: string;
    let url: string;
    let headers: Record<string, string> = {};
    let body: string | undefined;
    const params: Record<string, string> = {};
    let per: { verifySsl?: boolean; followRedirects?: boolean; useCookies?: boolean } = {};

    if (node.target.kind === 'inline') {
      method = node.target.method || 'GET';
      url = applyVars(node.target.url, vars);
      for (const h of node.target.headers || []) headers[h.key] = applyVars(h.value || '', vars);
      body = node.target.body != null ? applyVars(node.target.body, vars) : undefined;
    } else {
      const req = this.collections.findRequestById(node.target.requestId);
      if (!req) return null;
      method = METHOD_LABELS[req.httpMethod] || 'GET';
      url = applyVars(req.url || '', vars);
      headers = buildHeaders(req, vars);
      body = extractBody(req, vars);
      per = {
        verifySsl: req.settings?.verifySsl,
        followRedirects: req.settings?.followRedirects,
        useCookies: req.settings?.useCookies,
      };
    }

    if (url && !/^https?:\/\//i.test(url)) url = 'http://' + url;

    let certificate: Certificate | undefined;
    try {
      certificate = this.settings.getClientCertificateForHost(new URL(url).hostname);
    } catch {
      certificate = undefined;
    }

    return this.settings.applyGlobalNetworkToIpc(
      { method, url, headers, params, body, certificate, followRedirects: true, timeoutMs: 30000 },
      per,
    );
  }

  private finishWith(
    runId: string,
    flowId: string,
    startedAt: number,
    steps: FlowNodeRunResult[],
    variables: Record<string, unknown>,
    outcome: FlowRunResult['outcome'],
  ): FlowRunResult {
    const res: FlowRunResult = { runId, flowId, startedAt, endedAt: Date.now(), outcome, variables, steps };
    this.zone.run(() => this.done$.next(res));
    return res;
  }
}

function portFor(node: FlowNode, result: FlowNodeRunResult): 'out' | 'true' | 'false' {
  if (node.kind === 'branch') return result.message === 'true' ? 'true' : 'false';
  return 'out';
}

function applyVars(input: string, vars: Record<string, unknown>): string {
  if (!input) return input;
  let t = input.replace(/\{\{\s*([\w.-]+)\s*\}\}/g, (full, name) => {
    const v = vars[name];
    if (v == null) return full;
    return typeof v === 'string' ? v : JSON.stringify(v);
  });
  t = applyDynamicPlaceholders(t);
  return t;
}

function buildHeaders(req: RequestModel, vars: Record<string, unknown>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const h of req.httpHeaders || []) {
    if (h.enabled === false || !h.key) continue;
    out[h.key] = applyVars(h.value || '', vars);
  }
  return out;
}

function extractBody(req: RequestModel, vars: Record<string, unknown>): string | undefined {
  if (req.body && typeof req.body === 'object' && typeof req.body.raw === 'string') {
    return applyVars(req.body.raw, vars);
  }
  if (typeof req.requestBody === 'string' && req.requestBody) return applyVars(req.requestBody, vars);
  return undefined;
}

function asPreview(value: unknown): string {
  if (value == null) return String(value);
  if (typeof value === 'string') return value.length > 40 ? `${value.slice(0, 40)}…` : value;
  try {
    const s = JSON.stringify(value);
    return s.length > 40 ? `${s.slice(0, 40)}…` : s;
  } catch { return String(value); }
}

export type __FlowStatus = FlowNodeStatus;
