import { Injectable, NgZone } from '@angular/core';
import { Subject } from 'rxjs';
import type {
  LoadProgressEvent,
  LoadRunResult,
  LoadTestConfig,
  LoadTestTarget,
} from '@models/testing/load-test';
import { CollectionService } from './collection.service';
import { EnvironmentsService } from './environments.service';
import { SettingsService } from './settings.service';
import { pruneEmptyKv } from './kv-utils';
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
  async start(config: LoadTestConfig): Promise<string | null> {
    if (!window.awElectron?.loadStart) {
      console.warn('Load engine unavailable (no awElectron bridge).');
      return null;
    }
    await this.settings.loadSettings();
    const vars = this.snapshotVariables();
    const targets = (config.targets || [])
      .map((t) => this.resolveTargetToIpc(t, vars))
      .filter((t): t is IpcHttpRequest => !!t);
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

  private snapshotVariables(): Record<string, string> {
    const env = this.environments.getActiveContext();
    const map: Record<string, string> = {};
    if (env?.variables) {
      for (const v of env.variables) {
        if (v.key) map[v.key] = v.value ?? '';
      }
    }
    return map;
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
    const method = HttpMethod[req.httpMethod] || 'GET';
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
  return text.replace(/\{\{([^}]+)\}\}/g, (m, k) => {
    const v = vars[k.trim()];
    return v !== undefined ? v : m;
  });
}
