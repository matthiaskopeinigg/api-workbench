import { Injectable } from '@angular/core';
import { BehaviorSubject, Observable } from 'rxjs';
import { Collection, Folder } from '@models/collection';
import { HttpMethod, Request } from '@models/request';
import { EnvironmentsService } from '@core/environments/environments.service';
import { CollectionService } from '@core/collection/collection.service';
import { ScriptService } from '@core/http/script.service';
import type { Certificate } from '@models/settings';
import type { IpcHttpRequest } from '@models/ipc-http-request';
import type { IpcHttpResponse } from '@models/ipc-http-response';
import type { TestResult } from '@models/response';
import { pruneEmptyKv } from '@core/utils/kv-utils';
import { SettingsService } from '@core/settings/settings.service';
import { applyDynamicPlaceholders } from '@core/placeholders/dynamic-placeholders';

export interface RunnerOptions {
  iterations: number;
  delayMs: number;
  /** Optional environment id to activate for the run. */
  environmentId?: string | null;
  /** When true, each request's post-request script is executed for test results. */
  runTests: boolean;
}

export interface RunnerRequestResult {
  requestId: string;
  iteration: number;
  title: string;
  url: string;
  method: string;
  status: number;
  statusText?: string;
  timeMs?: number;
  size?: number;
  error?: string;
  testResults?: TestResult[];
}

export interface RunnerState {
  isRunning: boolean;
  total: number;
  completed: number;
  results: RunnerRequestResult[];
  startedAt: number | null;
  finishedAt: number | null;
}

/**
 * Executes a batch of requests (collection/folder) with basic iteration and
 * delay support. This is intentionally a thin wrapper around the existing
 * HTTP IPC — it does NOT resolve inherited auth/headers or run pre-request
 * scripts; those are handled by the per-request UI. The runner focuses on
 * smoke-testing a group of endpoints with their current inline configuration.
 */
@Injectable({ providedIn: 'root' })
export class RunnerService {
  private stateSubject = new BehaviorSubject<RunnerState>(this.emptyState());
  private cancelRequested = false;

  constructor(
    private collectionService: CollectionService,
    private environmentsService: EnvironmentsService,
    private scriptService: ScriptService,
    private settingsService: SettingsService,
  ) {}

  state$(): Observable<RunnerState> { return this.stateSubject.asObservable(); }

  cancel(): void { this.cancelRequested = true; }

  /** Flatten a collection/folder's requests in traversal order. */
  collectRequests(source: Collection | Folder): Request[] {
    const out: Request[] = [];
    const walk = (node: Collection | Folder) => {
      (node.requests || []).forEach(r => out.push(r));
      (node.folders || []).forEach(walk);
    };
    walk(source);
    return out;
  }

  async run(source: Collection | Folder, options: RunnerOptions): Promise<RunnerState> {
    await this.settingsService.loadSettings();
    const requests = this.collectRequests(source);
    if (requests.length === 0) {
      return this.stateSubject.getValue();
    }

    this.cancelRequested = false;
    const total = requests.length * Math.max(1, options.iterations);
    const startedAt = Date.now();
    this.push({
      isRunning: true,
      total,
      completed: 0,
      results: [],
      startedAt,
      finishedAt: null,
    });

    const activeVars = this.snapshotVariables();

    for (let iteration = 1; iteration <= Math.max(1, options.iterations); iteration++) {
      for (const request of requests) {
        if (this.cancelRequested) break;
        const result = await this.runOne(request, iteration, activeVars, options);
        const state = this.stateSubject.getValue();
        this.push({
          ...state,
          completed: state.completed + 1,
          results: [...state.results, result],
        });
        if (options.delayMs > 0) {
          await delay(options.delayMs);
        }
      }
      if (this.cancelRequested) break;
    }

    const finishedAt = Date.now();
    const current = this.stateSubject.getValue();
    const final = { ...current, isRunning: false, finishedAt };
    this.push(final);
    return final;
  }

  private async runOne(
    request: Request,
    iteration: number,
    activeVariables: Record<string, string>,
    options: RunnerOptions,
  ): Promise<RunnerRequestResult> {
    const url = substitute(request.url || '', activeVariables);
    const methodValue = request.httpMethod ?? HttpMethod.GET;
    const method = typeof methodValue === 'number' ? HttpMethod[methodValue] : String(methodValue);
    const base: RunnerRequestResult = {
      requestId: request.id,
      iteration,
      title: request.title || request.url || '(untitled)',
      url,
      method,
      status: 0,
    };

    try {
      const ipc = this.buildIpcRequest(request, activeVariables);
      const response = await window.awElectron.httpRequest(ipc);
      const r = response as IpcHttpResponse | null;
      base.status = r?.status ?? 0;
      base.statusText = r?.statusText;
      base.timeMs = r?.timeMs;
      base.size = r?.size;

      if (options.runTests && request.script?.postRequest && r) {
        const headers = Array.isArray(r.headers)
          ? Object.entries(r.headers).map(([k, v]) => [String(k), String(v)])
          : [];
        const scriptResult = await this.scriptService.runScript(request.script.postRequest, {
          environment: activeVariables,
          globals: {},
          variables: {},
          request: {
            method,
            url,
            headers: (ipc.headers ? Object.entries(ipc.headers) : []) as Array<[string, string]>,
            body: typeof ipc.body === 'string' ? ipc.body : '',
          },
          response: {
            code: r.status,
            status: r.statusText,
            headers,
            body: typeof r.body === 'string' ? r.body : JSON.stringify(r.body ?? ''),
            responseTime: r.timeMs,
            size: r.size,
          },
        }) as { testResults?: TestResult[] } | null;
        if (scriptResult?.testResults) base.testResults = scriptResult.testResults;
      }
    } catch (err) {
      base.error = err instanceof Error ? err.message : String(err);
    }
    return base;
  }

  private buildIpcRequest(request: Request, activeVariables: Record<string, string>): IpcHttpRequest {
    const headers: Record<string, string> = {};
    for (const h of pruneEmptyKv(request.httpHeaders || [])) {
      if (h.enabled === false) continue;
      headers[substitute(h.key, activeVariables)] = substitute(h.value || '', activeVariables);
    }
    const params: Record<string, string> = {};
    for (const p of pruneEmptyKv(request.httpParameters || [])) {
      if (p.enabled === false) continue;
      params[substitute(p.key, activeVariables)] = substitute(p.value || '', activeVariables);
    }

    let url = substitute(request.url || '', activeVariables).trim();
    if (url && !/^https?:\/\//i.test(url)) url = 'http://' + url;

    const methodValue = request.httpMethod ?? HttpMethod.GET;
    const method = typeof methodValue === 'number' ? HttpMethod[methodValue] : String(methodValue);
    let certificate: Certificate | undefined;
    try {
      certificate = this.settingsService.getClientCertificateForHost(new URL(url).hostname);
    } catch {
      certificate = undefined;
    }
    return this.settingsService.applyGlobalNetworkToIpc(
      {
        method,
        url,
        headers,
        params,
        body: substitute(request.requestBody || '', activeVariables),
        certificate,
      },
      {
        verifySsl: request.settings?.verifySsl,
        followRedirects: request.settings?.followRedirects,
        useCookies: request.settings?.useCookies,
      },
    );
  }

  private snapshotVariables(): Record<string, string> {
    const env = this.environmentsService.getActiveContext();
    const map: Record<string, string> = {};
    if (env?.variables) {
      for (const v of env.variables) {
        if (v.key) map[v.key] = v.value ?? '';
      }
    }
    return map;
  }

  private emptyState(): RunnerState {
    return { isRunning: false, total: 0, completed: 0, results: [], startedAt: null, finishedAt: null };
  }

  private push(state: RunnerState) { this.stateSubject.next(state); }
}

function substitute(text: string, vars: Record<string, string>): string {
  if (!text) return text;
  let t = text.replace(/\{\{([^}]+)\}\}/g, (match, key) => {
    const val = vars[key.trim()];
    return val !== undefined ? val : match;
  });
  t = applyDynamicPlaceholders(t);
  return t;
}

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
