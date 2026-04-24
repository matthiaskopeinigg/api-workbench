import { applyDynamicPlaceholders } from '@core/placeholders/dynamic-placeholders';
import { AuthType, type RequestAuth } from '@models/request';

/** `{{var}}` substitution using active environment map + dynamic placeholders. */
export function substituteWsVariables(text: string, activeVariables: Record<string, string>): string {
  if (!text || typeof text !== 'string') return text;
  let t = text.replace(/\{\{([^}]+)\}\}/g, (match, key) => {
    const k = String(key).trim();
    const val = activeVariables[k];
    return val !== undefined ? val : match;
  });
  t = applyDynamicPlaceholders(t);
  return t;
}

/**
 * Headers derived from structured auth for WebSocket/SSE connect.
 * Only bearer, basic, and api_key (header) are supported for v1.
 */
export function authHeadersForWebSocketConnect(
  auth: RequestAuth | undefined,
  sub: (s: string) => string,
): Record<string, string> {
  const out: Record<string, string> = {};
  if (!auth || auth.type === AuthType.NONE || auth.type === AuthType.INHERIT) {
    return out;
  }
  if (auth.type === AuthType.BEARER && auth.bearer?.token) {
    out['Authorization'] = `Bearer ${sub(auth.bearer.token)}`;
  } else if (auth.type === AuthType.BASIC && (auth.basic?.username || auth.basic?.password)) {
    const raw = `${sub(auth.basic?.username || '')}:${sub(auth.basic?.password || '')}`;
    out['Authorization'] = `Basic ${btoa(raw)}`;
  } else if (auth.type === AuthType.API_KEY && auth.apiKey?.key) {
    const addTo = auth.apiKey.addTo || 'header';
    if (addTo === 'header') {
      out[sub(auth.apiKey.key)] = sub(auth.apiKey.value || '');
    }
  }
  return out;
}

/** Manual headers from tab rows (enabled only), keys/values substituted. */
export function manualHeadersForWebSocketConnect(
  headers: Array<{ key: string; value: string; enabled?: boolean }> | undefined,
  sub: (s: string) => string,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const h of headers || []) {
    if (h.enabled === false || !(h.key || '').trim()) continue;
    const key = sub((h.key || '').trim());
    if (!key) continue;
    out[key] = sub(h.value || '');
  }
  return out;
}

/** Merge: manual first, then auth overwrites same keys. */
export function mergeWebSocketConnectHeaders(
  manual: Record<string, string>,
  auth: Record<string, string>,
): Record<string, string> {
  return { ...manual, ...auth };
}
