import { Injectable, NgZone } from '@angular/core';
import { Subject } from 'rxjs';
import type {
  LoadProgressEvent,
  LoadRunResult,
  LoadTestConfig,
  LoadTestTarget,
} from '@models/testing/load-test';
import { CollectionService } from './collection.service';
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
  ) {}

  onProgress() { return this.progress$.asObservable(); }
  onDone() { return this.done$.asObservable(); }

  /**
   * Resolve any 'saved' targets to inline shapes (using the current request
   * tree + active environment), then hand off to the engine. Returns the
   * runId so the component can cross-reference progress events.
   */
  async start(config: LoadTestConfig): Promise<string | null> {
    if (!window.awElectron?.loadStart) {
      console.warn('Load engine unavailable (no awElectron bridge).');
      return null;
    }
    const resolved: LoadTestConfig = {
      ...config,
      targets: (config.targets || []).map((t) => this.resolveTarget(t)).filter((t): t is LoadTestTarget => !!t),
    };
    if (resolved.targets.length === 0) {
      console.warn('Load run aborted: no resolvable targets.');
      return null;
    }
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

  private resolveTarget(target: LoadTestTarget): LoadTestTarget | null {
    if (target.kind === 'inline') return target;
    const req = this.collections.findRequestById(target.requestId);
    if (!req) return null;
    return inlineFromSavedRequest(req);
  }
}

/**
 * Flatten a saved Request into the inline shape the engine consumes.
 * Variable interpolation ({{base_url}} etc.) is intentionally left to the
 * main-process HTTP service — same code path as a normal "Send", so the
 * load engine doesn't need its own variable engine.
 */
function inlineFromSavedRequest(req: Request) {
  const headers = (req.httpHeaders || [])
    .filter((h) => h.enabled !== false && !!h.key)
    .map((h) => ({ key: h.key, value: h.value || '' }));
  const url = req.url || '';
  const method = HttpMethod[req.httpMethod] || 'GET';
  let body: string | undefined;
  if (req.body && typeof req.body === 'object' && typeof req.body.raw === 'string') {
    body = req.body.raw;
  } else if (typeof req.requestBody === 'string' && req.requestBody) {
    body = req.requestBody;
  }
  return { kind: 'inline' as const, method, url, headers, body };
}
