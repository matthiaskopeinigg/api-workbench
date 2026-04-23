import { Injectable, NgZone } from '@angular/core';
import { Subject } from 'rxjs';
import type {
  LoadProgressEvent,
  LoadRunResult,
  LoadTestConfig,
  LoadTestTarget,
} from '@models/testing/load-test';
import { CollectionService } from '@core/collection/collection.service';
import { EnvironmentsService } from '@core/environments/environments.service';
import { SettingsService } from '@core/settings/settings.service';
import { buildWorkspaceVariableMap } from '@core/placeholders/env-substitute';
import { applyDynamicPlaceholders } from '@core/placeholders/dynamic-placeholders';
import { pruneEmptyKv } from '@core/utils/kv-utils';
import type { IpcHttpRequest } from '@models/ipc-http-request';
import type { Certificate } from '@models/settings';
import { HttpMethod, type Request } from '@models/request';

interface ActiveSubscription {
  runId: string;
  unsubscribeProgress: () => void;
  unsubscribeDone: () => void;
}

/**
 * Renderer-side facade for the Load Test engine. Hides the IPC plumbing
 * behind plain Subjects so the component can subscribe in the standard way.
 *
 * One subscription per run; stop()/cancel() releases listeners.
 */
@Injectable({ providedIn: 'root' })
export class LoadTestService {
  private active = new Map<string, ActiveSubscription>();

  /** Per-run progress channels. */
  private progress$ = new Subject<LoadProgressEvent>();
  /** Per-run terminal events. */
  private done$ = new Subject<LoadRunResult>();

  constructor(
    private collections: CollectionService,
    private zone: NgZone,
    private settings: SettingsService,
    private environments: EnvironmentsService,
  ) {}

  onProgress() { return this.progress$.asObservable(); }
  onDone() { return this.done$.asObservable(); }

  /**
   * Resolves each target to a full {@link IpcHttpRequest} (mTLS, proxy, SSL,
   * time-outs) like Send / the collection runner, then hands off to the main
   * process load engine.
   */
  async start(
    config: LoadTestConfig,
    runOptions?: { environmentId?: string | null },
  ): Promise<string | null> {
    if (!window.awElectron?.loadStart) {
      console.warn('Load engine unavailable (no awElectron bridge).');
      return null;
    }
    await this.settings.loadSettings();
    await this.environments.loadEnvironments();
    const vars = this.snapshotVariables(runOptions?.environmentId);
    const rawTargets = (config.targets || []).slice(0, 1);
    const targets = rawTargets
      .map((t) => this.resolveTargetToIpc(t, vars))
      .filter((t): t is IpcHttpRequest => !!t);
    if (rawTargets.length > 0 && targets.length < rawTargets.length) {
      const skipped = rawTargets.length - targets.length;
      console.warn(
        `Load test: ${skipped} target(s) skipped (saved request missing or not loaded). ` +
          `Running ${targets.length} of ${rawTargets.length} — add the request to the collection or pick another.`,
      );
    }
    if (targets.length === 0) {
      console.warn('Load run aborted: no resolvable targets.');
      return null;
    }
    const resolved = { ...config, targets } as unknown as LoadTestConfig;
    const res = await window.awElectron.loadStart(resolved);
    if (!res.ok || !res.runId) return null;

    const offProgress = window.awElectron.onLoadProgress!(res.runId, (event) => {
      this.zone.run(() => this.progress$.next(event));
    });
    const offDone = window.awElectron.onLoadDone!(res.runId, (result) => {
      this.zone.run(() => {
        this.done$.next(result);
        const sub = this.active.get(res.runId!);
        if (sub) {
          sub.unsubscribeProgress();
          sub.unsubscribeDone();
          this.active.delete(res.runId!);
        }
      });
    });
    this.active.set(res.runId, {
      runId: res.runId,
      unsubscribeProgress: offProgress,
      unsubscribeDone: offDone,
    });
    return res.runId;
  }

  async cancel(runId: string): Promise<void> {
    if (!window.awElectron?.loadCancel) return;
    await window.awElectron.loadCancel(runId);
  }

  private snapshotVariables(environmentId?: string | null): Record<string, string> {
    const m = buildWorkspaceVariableMap(this.environments, {
      environmentId: environmentId == null || environmentId === '' ? undefined : environmentId,
    });
    const map: Record<string, string> = {};
    m.forEach((v, k) => { map[k] = v; });
    return map;
  }

  /**
   * Map numeric {@link HttpMethod} to a method name. GET = 0 must never be treated as
   * "missing" via truthy checks (0 is falsy in JS).
   * Order must match `enum HttpMethod` in `@models/request`.
   */
  private resolveHttpMethodName(httpMethod: HttpMethod | undefined | null): string {
    if (httpMethod === undefined || httpMethod === null) {
      return 'GET';
    }
    const table = [
      'GET',
      'POST',
      'PUT',
      'PATCH',
      'DELETE',
      'HEAD',
      'OPTIONS',
    ] as const;
    const s = table[httpMethod as number];
    return s ?? 'GET';
  }

  private resolveTargetToIpc(t: LoadTestTarget, vars: Record<string, string>): IpcHttpRequest | null {
    if (t.kind === 'inline') {
      return this.buildIpcFromInline(t, vars);
    }
    const req = this.collections.findRequestById(t.requestId);
    if (!req) return null;
    return this.buildIpcFromSavedRequest(req, vars);
  }

  private buildIpcFromSavedRequest(req: Request, vars: Record<string, string>): IpcHttpRequest {
    const headers: Record<string, string> = {};
    for (const h of pruneEmptyKv(req.httpHeaders || [])) {
      if (h.enabled === false) continue;
      headers[subst(h.key, vars)] = subst(h.value || '', vars);
    }
    const params: Record<string, string> = {};
    for (const p of pruneEmptyKv(req.httpParameters || [])) {
      if (p.enabled === false) continue;
      params[subst(p.key, vars)] = subst(p.value || '', vars);
    }
    let url = subst(req.url || '', vars).trim();
    if (url && !/^https?:\/\//i.test(url)) url = 'http://' + url;
    const method = this.resolveHttpMethodName(req.httpMethod);
    let body: string | undefined;
    if (req.body && typeof req.body === 'object' && typeof req.body.raw === 'string') {
      body = subst(req.body.raw, vars);
    } else if (typeof req.requestBody === 'string' && req.requestBody) {
      body = subst(req.requestBody, vars);
    }
    let certificate: Certificate | undefined;
    try {
      certificate = this.settings.getClientCertificateForHost(new URL(url).hostname);
    } catch {
      certificate = undefined;
    }
    return this.settings.applyGlobalNetworkToIpc(
      { method, url, headers, params, body, certificate },
      {
        verifySsl: req.settings?.verifySsl,
        followRedirects: req.settings?.followRedirects,
        useCookies: req.settings?.useCookies,
      },
    );
  }

  private buildIpcFromInline(
    t: LoadTestTarget & { kind: 'inline' },
    vars: Record<string, string>,
  ): IpcHttpRequest {
    const headers: Record<string, string> = {};
    for (const h of t.headers || []) {
      if (h?.key) headers[subst(h.key, vars)] = subst(h.value || '', vars);
    }
    let url = subst(t.url || '', vars).trim();
    if (url && !/^https?:\/\//i.test(url)) url = 'http://' + url;
    const method = t.method || 'GET';
    const body = t.body != null ? subst(t.body, vars) : undefined;
    let certificate: Certificate | undefined;
    try {
      certificate = this.settings.getClientCertificateForHost(new URL(url).hostname);
    } catch {
      certificate = undefined;
    }
    return this.settings.applyGlobalNetworkToIpc(
      { method, url, headers, params: {}, body, certificate },
      {},
    );
  }
}

function subst(text: string, vars: Record<string, string>): string {
  if (!text) return text;
  let t = text.replace(/\{\{([^}]+)\}\}/g, (m, k) => {
    const v = vars[k.trim()];
    return v !== undefined ? v : m;
  });
  t = applyDynamicPlaceholders(t);
  return t;
}
