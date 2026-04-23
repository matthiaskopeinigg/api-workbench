import { Injectable, NgZone } from '@angular/core';
import { Subject } from 'rxjs';
import type {
  LoadProgressEvent,
  LoadRunResult,
  LoadTestConfig,
  LoadTestTarget,
} from '@models/testing/load-test';
import { CollectionService } from '@core/collection/collection.service';
import type { Folder } from '@models/collection';
import { EnvironmentsService } from '@core/environments/environments.service';
import { SettingsService } from '@core/settings/settings.service';
import { buildWorkspaceVariableMap } from '@core/placeholders/env-substitute';
import { applyDynamicPlaceholders } from '@core/placeholders/dynamic-placeholders';
import { hasKey, pruneEmptyKv } from '@core/utils/kv-utils';
import { AuthSignerService } from '@core/http/auth-signer.service';
import type { IpcHttpRequest } from '@models/ipc-http-request';
import type { Certificate } from '@models/settings';
import { AuthType, HttpMethod, type Request, type RequestAuth } from '@models/request';

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
    private authSigner: AuthSignerService,
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
    const resolvedList = await Promise.all(rawTargets.map((t) => this.resolveTargetToIpc(t, vars)));
    const targets = resolvedList.filter((t): t is IpcHttpRequest => !!t);
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

  private async resolveTargetToIpc(t: LoadTestTarget, vars: Record<string, string>): Promise<IpcHttpRequest | null> {
    if (t.kind === 'inline') {
      return this.buildIpcFromInline(t, vars);
    }
    const req = this.collections.findRequestById(t.requestId);
    if (!req) return null;
    return this.buildIpcFromSavedRequest(req, vars);
  }

  private async buildIpcFromSavedRequest(req: Request, vars: Record<string, string>): Promise<IpcHttpRequest> {
    const settings = this.settings.getSettings();
    const parents = this.collections.getParentFolders(req.id);
    const disabledDefaults = req.disabledDefaultHeaders || [];

    const headers: Record<string, string> = {};
    const params: Record<string, string> = {};

    const addHeader = (h: { key?: string; value?: string; enabled?: boolean }) => {
      if (h.enabled === false || !hasKey(h)) return;
      const key = subst((h.key as string).trim(), vars);
      if (!key) return;
      headers[key] = subst(h.value || '', vars);
    };

    if (settings.headers?.addDefaultHeaders && settings.headers.defaultHeaders) {
      for (const h of settings.headers.defaultHeaders) {
        if (!hasKey(h) || disabledDefaults.includes((h.key as string).trim())) continue;
        addHeader(h);
      }
    }
    parents.forEach((p) => (p.httpHeaders || []).forEach(addHeader));
    for (const h of pruneEmptyKv(req.httpHeaders || [])) {
      if (h.enabled === false) continue;
      addHeader(h);
    }

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

    const resolvedSettings = {
      verifySsl: req.settings?.verifySsl,
      followRedirects: req.settings?.followRedirects,
      useCookies: req.settings?.useCookies,
    };
    const parentSettings = [...parents].reverse().map((p) => p.settings).filter((s) => !!s);
    for (const ps of parentSettings) {
      if (resolvedSettings.verifySsl === undefined) resolvedSettings.verifySsl = ps?.verifySsl;
      if (resolvedSettings.followRedirects === undefined) resolvedSettings.followRedirects = ps?.followRedirects;
      if (resolvedSettings.useCookies === undefined) resolvedSettings.useCookies = ps?.useCookies;
    }
    if (resolvedSettings.followRedirects === undefined) resolvedSettings.followRedirects = true;
    if (resolvedSettings.useCookies === undefined) {
      resolvedSettings.useCookies = settings.requests?.useCookies;
    }

    const effectiveAuth = resolveEffectiveAuth(req, parents);
    await applyAuthHeaders(
      this.authSigner,
      effectiveAuth,
      method,
      url,
      headers,
      params,
      body ?? '',
      vars,
    );

    return this.settings.applyGlobalNetworkToIpc(
      { method, url, headers, params, body, certificate },
      {
        verifySsl: resolvedSettings.verifySsl,
        followRedirects: resolvedSettings.followRedirects,
        useCookies: resolvedSettings.useCookies,
      },
    );
  }

  private buildIpcFromInline(
    t: LoadTestTarget & { kind: 'inline' },
    vars: Record<string, string>,
  ): IpcHttpRequest {
    const settings = this.settings.getSettings();
    const headers: Record<string, string> = {};
    if (settings.headers?.addDefaultHeaders && settings.headers.defaultHeaders) {
      for (const h of settings.headers.defaultHeaders) {
        if (!hasKey(h)) continue;
        const key = subst((h.key as string).trim(), vars);
        if (!key) continue;
        headers[key] = subst(h.value || '', vars);
      }
    }
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

/** Same inheritance rules as {@link RequestComponent.sendRequest}. */
function resolveEffectiveAuth(req: Request, parents: Folder[]): RequestAuth | undefined {
  let effectiveAuth = req.auth;
  if (!effectiveAuth || effectiveAuth.type === AuthType.INHERIT) {
    for (const parent of [...parents].reverse()) {
      if (parent.auth && parent.auth.type !== AuthType.INHERIT) {
        effectiveAuth = parent.auth;
        break;
      }
    }
  }
  if (!effectiveAuth || effectiveAuth.type === AuthType.INHERIT || effectiveAuth.type === AuthType.NONE) {
    return undefined;
  }
  return effectiveAuth;
}

async function applyAuthHeaders(
  authSigner: AuthSignerService,
  auth: RequestAuth | undefined,
  method: string,
  url: string,
  headers: Record<string, string>,
  params: Record<string, string>,
  body: string,
  vars: Record<string, string>,
): Promise<void> {
  if (!auth) return;
  const s = (x: string) => subst(x, vars);

  if (auth.type === AuthType.BEARER && auth.bearer?.token) {
    headers['Authorization'] = `Bearer ${s(auth.bearer.token)}`;
    return;
  }
  if (auth.type === AuthType.BASIC && (auth.basic?.username || auth.basic?.password)) {
    const raw = `${s(auth.basic?.username || '')}:${s(auth.basic?.password || '')}`;
    headers['Authorization'] = `Basic ${btoa(raw)}`;
    return;
  }
  if (auth.type === AuthType.API_KEY && auth.apiKey?.key) {
    const key = s(auth.apiKey.key);
    const val = s(auth.apiKey.value || '');
    if (auth.apiKey.addTo === 'query') {
      params[key] = val;
    } else {
      headers[key] = val;
    }
    return;
  }
  if (auth.type === AuthType.OAUTH2 && auth.oauth2?.accessToken) {
    headers['Authorization'] = `Bearer ${s(auth.oauth2.accessToken)}`;
    return;
  }
  if (auth.type === AuthType.NTLM) {
    console.warn('Load test: NTLM auth is not supported; request is sent without NTLM.');
    return;
  }
  if (auth.type === AuthType.DIGEST || auth.type === AuthType.AWS_SIGV4 || auth.type === AuthType.HAWK) {
    const signed = await authSigner.sign(
      auth,
      { method, url, headers, params, body },
      (t) => s(t || ''),
    );
    Object.assign(headers, signed.headers);
    Object.assign(params, signed.params);
  }
}
