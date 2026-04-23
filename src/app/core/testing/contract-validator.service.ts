import { Injectable, NgZone } from '@angular/core';
import { v4 as uuidv4 } from 'uuid';
import { Subject } from 'rxjs';

import { CollectionService } from '@core/collection/collection.service';
import { SettingsService } from '@core/settings/settings.service';
import { EnvironmentsService } from '@core/environments/environments.service';
import { buildWorkspaceVariableMap, substituteVariables } from '@core/placeholders/env-substitute';
import type { Certificate } from '@models/settings';
import { HttpMethod, type Request as RequestModel } from '@models/request';
import type { Collection, Folder } from '@models/collection';
import type {
  ContractFinding,
  ContractRunResult,
  ContractTestArtifact,
} from '@models/testing/contract-test';
import { matchOperation, parseOpenApi, type ParsedSpec, type SpecOperation } from '@core/import-pipeline/openapi-parser';

interface RawResponse {
  status: number;
  statusText?: string;
  headers?: Record<string, string> | Array<{ key: string; value: string }>;
  body?: unknown;
  timeMs?: number;
  size?: number;
}

interface RunOptions {
  /** When true, skip sending requests and only do static analysis (documented-vs-undocumented). */
  staticOnly?: boolean;
  /** When set, use this environment for `{{var}}` in URLs and request parts. */
  environmentId?: string | null;
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
 * Runs a ContractTestArtifact: parses its spec, walks the target collection,
 * and emits findings comparing the two.
 *
 * What we catch today:
 *  - `undocumented`: a saved request has no matching operation
 *  - `spec-only`:    an operation has no matching saved request
 *  - `drift`:        actual response status is not listed in the spec's responses
 *  - `mismatch`:     required parameters declared by the spec are missing
 *    from the saved request
 *
 * What we don't (yet): full JSON schema validation of response bodies. The
 * infrastructure is here, so plugging in Ajv is a follow-up.
 */
@Injectable({ providedIn: 'root' })
export class ContractValidatorService {
  private finding$ = new Subject<{ contractId: string; finding: ContractFinding }>();
  private finished$ = new Subject<ContractRunResult>();

  constructor(
    private collections: CollectionService,
    private zone: NgZone,
    private settings: SettingsService,
    private environments: EnvironmentsService,
  ) {}

  onFinding() { return this.finding$.asObservable(); }
  onFinished() { return this.finished$.asObservable(); }

  async run(artifact: ContractTestArtifact, opts: RunOptions = {}): Promise<ContractRunResult> {
    await this.settings.loadSettings();
    await this.environments.loadEnvironments();
    const varMap = buildWorkspaceVariableMap(this.environments, {
      environmentId: opts.environmentId == null || opts.environmentId === '' ? undefined : opts.environmentId,
    });
    const startedAt = Date.now();
    const findings: ContractFinding[] = [];
    const emit = (f: ContractFinding) => {
      findings.push(f);
      this.zone.run(() => this.finding$.next({ contractId: artifact.id, finding: f }));
    };

    const spec = this.loadSpec(artifact);
    if (spec.errors.length > 0) {
      for (const e of spec.errors) {
        emit({
          id: uuidv4(), kind: 'mismatch', severity: 'warning',
          path: '(spec)', method: '-', message: e,
        });
      }
    }

    const requests = this.resolveScope(artifact);
    const matchedOperationKeys = new Set<string>();

    for (const req of requests) {
      const method = METHOD_LABELS[req.httpMethod] || 'GET';
      const url = resolveRequestUrlForContract(req, varMap);
      const match = matchOperation(spec, method, url);

      if (!match) {
        emit({
          id: uuidv4(), kind: 'undocumented', severity: 'warning',
          path: url, method, requestId: req.id,
          message: `${method} ${url} is not described in the spec.`,
        });
        continue;
      }

      matchedOperationKeys.add(opKey(match.operation));

      for (const p of match.operation.parameters) {
        if (!p.required) continue;
        const present = paramPresent(p.in, p.name, req, { resolvedUrl: url, pathParams: match.pathParams });
        if (!present) {
          emit({
            id: uuidv4(), kind: 'mismatch', severity: 'warning',
            path: match.operation.path, method, requestId: req.id,
            message: `Required ${p.in} parameter "${p.name}" is missing from the saved request.`,
          });
        }
      }

      if (opts.staticOnly) continue;

      try {
        const response = await this.sendRequest(req, varMap);
        const declaredStatuses = Object.keys(match.operation.responses);
        const expectedMatch = declaredStatuses.some((code) =>
          code === String(response.status) || code === rangeOf(response.status) || code === 'default',
        );
        if (!expectedMatch) {
          emit({
            id: uuidv4(), kind: 'drift', severity: 'error',
            path: match.operation.path, method, requestId: req.id,
            actual: snapshotResponse(response),
            expected: declaredStatuses.join(', ') || '(none)',
            message: `Received ${response.status} but spec only documents: ${declaredStatuses.join(', ') || '(none)'}`,
          });
        } else {
          emit({
            id: uuidv4(), kind: 'ok', severity: 'info',
            path: match.operation.path, method, requestId: req.id,
            actual: snapshotResponse(response),
            message: `Status ${response.status} matches spec (${declaredStatuses.join(', ')}).`,
          });
        }
      } catch (err) {
        emit({
          id: uuidv4(), kind: 'drift', severity: 'error',
          path: match.operation.path, method, requestId: req.id,
          message: `Request failed: ${err instanceof Error ? err.message : String(err)}`,
        });
      }
    }

    for (const op of spec.operations) {
      if (matchedOperationKeys.has(opKey(op))) continue;
      emit({
        id: uuidv4(), kind: 'spec-only', severity: 'info',
        path: op.path, method: op.method,
        message: `${op.method} ${op.path} is documented but no saved request targets it.`,
      });
    }

    const totals = countTotals(findings);
    const result: ContractRunResult = {
      runId: uuidv4(),
      contractId: artifact.id,
      startedAt,
      endedAt: Date.now(),
      totals,
      findings,
    };
    this.zone.run(() => this.finished$.next(result));
    return result;
  }

  private loadSpec(artifact: ContractTestArtifact): ParsedSpec {
    if (artifact.spec.kind === 'inline') {
      return parseOpenApi(artifact.spec.body || '', artifact.spec.format);
    }
    const body = artifact.spec.cachedBody || '';
    const format = artifact.spec.cachedFormat || 'auto';
    return parseOpenApi(body, format);
  }

  private resolveScope(artifact: ContractTestArtifact): RequestModel[] {
    const cols = this.collections.getCollections();
    if (!artifact.scope.collectionId) return [];
    const col = cols.find((c) => c.id === artifact.scope.collectionId);
    if (!col) return [];
    if (!artifact.scope.folderId) return flattenCollection(col);
    const folder = findFolderIn(col, artifact.scope.folderId);
    return folder ? flattenFolder(folder) : [];
  }

  private async sendRequest(req: RequestModel, varMap: Map<string, string>): Promise<RawResponse> {
    const method = METHOD_LABELS[req.httpMethod] || 'GET';
    const headers: Record<string, string> = {};
    for (const h of req.httpHeaders || []) {
      if (h.enabled === false || !h.key) continue;
      headers[substituteVariables(h.key, varMap)] = substituteVariables(h.value || '', varMap);
    }
    const params: Record<string, string> = {};
    for (const p of req.httpParameters || []) {
      if (p.enabled === false || !p.key) continue;
      params[substituteVariables(p.key, varMap)] = substituteVariables(p.value || '', varMap);
    }
    const rawBody =
      typeof req.requestBody === 'string' ? req.requestBody : (req.body && typeof req.body === 'object' ? req.body.raw : undefined);
    const body = rawBody != null ? substituteVariables(String(rawBody), varMap) : undefined;
    let url = resolveRequestUrlForContract(req, varMap);
    let certificate: Certificate | undefined;
    try {
      certificate = this.settings.getClientCertificateForHost(new URL(url).hostname);
    } catch {
      certificate = undefined;
    }

    const ipcReq = this.settings.applyGlobalNetworkToIpc(
      {
        method,
        url,
        headers,
        params,
        body,
        certificate,
        followRedirects: true,
        timeoutMs: 30000,
      },
      {
        verifySsl: req.settings?.verifySsl,
        followRedirects: req.settings?.followRedirects,
        useCookies: req.settings?.useCookies,
      },
    );
    return await window.awElectron.httpRequest(ipcReq as never) as RawResponse;
  }
}

function opKey(op: SpecOperation): string {
  return `${op.method} ${op.path}`;
}

/** Resolve `{{var}}` in the request URL; match OpenAPI the same way as Send / test runs. */
function resolveRequestUrlForContract(req: RequestModel, varMap: Map<string, string>): string {
  let url = substituteVariables(req.url || '', varMap).trim();
  if (url && !/^https?:\/\//i.test(url)) {
    url = 'http://' + url;
  }
  return url;
}

function paramPresent(
  where: 'query' | 'header' | 'path' | 'cookie',
  name: string,
  req: RequestModel,
  ctx?: { resolvedUrl: string; pathParams: Record<string, string> },
): boolean {
  if (where === 'header') {
    return (req.httpHeaders || []).some((h) => h.key?.toLowerCase() === name.toLowerCase() && h.enabled !== false);
  }
  if (where === 'query') {
    return (req.httpParameters || []).some((p) => p.key === name && p.enabled !== false);
  }
  if (where === 'path') {
    if (ctx?.pathParams && name in ctx.pathParams && String(ctx.pathParams[name] ?? '') !== '') {
      return true;
    }
    const u = ctx?.resolvedUrl || (req.url || '');
    return u.includes(`{${name}}`) || u.includes(`:${name}`);
  }
  return true;
}

function rangeOf(code: number): string {
  return `${Math.floor(code / 100)}XX`;
}

function snapshotResponse(r: RawResponse) {
  const headerList: Array<{ key: string; value: string }> = [];
  if (Array.isArray(r.headers)) {
    for (const h of r.headers) if (h?.key) headerList.push({ key: h.key, value: h.value });
  } else if (r.headers) {
    for (const [k, v] of Object.entries(r.headers)) headerList.push({ key: k, value: String(v) });
  }
  let body: string | undefined;
  if (r.body != null) {
    body = typeof r.body === 'string' ? r.body : safeJson(r.body);
  }
  return {
    status: r.status,
    statusText: r.statusText,
    contentType: findHeader(headerList, 'content-type'),
    headers: headerList,
    body,
  };
}

function findHeader(list: Array<{ key: string; value: string }>, name: string): string | undefined {
  const lower = name.toLowerCase();
  for (const h of list) if (h.key.toLowerCase() === lower) return h.value;
  return undefined;
}

function safeJson(value: unknown): string {
  try { return JSON.stringify(value); } catch { return String(value); }
}

function countTotals(findings: ContractFinding[]) {
  const t = { error: 0, warning: 0, info: 0, ok: 0 };
  for (const f of findings) {
    if (f.kind === 'ok') t.ok++;
    else if (f.severity === 'error') t.error++;
    else if (f.severity === 'warning') t.warning++;
    else t.info++;
  }
  return t;
}

function flattenCollection(col: Collection): RequestModel[] {
  const out: RequestModel[] = [...(col.requests || [])];
  const walk = (folders: Folder[] = []) => {
    for (const f of folders) {
      if (f.requests) out.push(...f.requests);
      if (f.folders?.length) walk(f.folders);
    }
  };
  walk(col.folders || []);
  return out;
}

function flattenFolder(f: Folder): RequestModel[] {
  const out: RequestModel[] = [...(f.requests || [])];
  if (f.folders) for (const child of f.folders) out.push(...flattenFolder(child));
  return out;
}

function findFolderIn(col: Collection, folderId: string): Folder | null {
  const walk = (folders: Folder[] = []): Folder | null => {
    for (const f of folders) {
      if (f.id === folderId) return f;
      const nested = walk(f.folders);
      if (nested) return nested;
    }
    return null;
  };
  return walk(col.folders || []);
}
