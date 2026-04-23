import { Injectable } from '@angular/core';
import { AuthType, RequestAuth } from '@models/request';

/**
 * The minimal outbound request shape consumed by the signing helpers. We
 * deliberately pass a plain object (rather than the `Request` model) so the
 * caller can feed us the post-substitution URL, method, and body that will
 * actually hit the wire.
 */
export interface OutboundRequest {
  method: string;
  url: string;
  headers: Record<string, string>;
  params: Record<string, string>;
  body: string;
}

/**
 * Result returned by `sign(...)`. The caller merges `headers` / `params` into
 * the outbound request. `headers`/`params` values are added as-is and are
 * expected to already be variable-resolved.
 */
export interface AuthApplyResult {
  headers: Record<string, string>;
  params: Record<string, string>;
}

const EMPTY_RESULT: AuthApplyResult = { headers: {}, params: {} };

/**
 * Computes auth headers/params for the extended auth types (Digest, AWS
 * SigV4, Hawk). Basic/Bearer/API key are still applied inline in the request
 * component since they don't need async signing — but this service can be
 * grown into a single funnel later.
 */
@Injectable({ providedIn: 'root' })
export class AuthSignerService {
  async sign(
    auth: RequestAuth | undefined,
    outbound: OutboundRequest,
    resolve: (s: string) => string
  ): Promise<AuthApplyResult> {
    if (!auth) return EMPTY_RESULT;
    switch (auth.type) {
      case AuthType.DIGEST:
        return this.signDigest(auth, outbound, resolve);
      case AuthType.AWS_SIGV4:
        return this.signAwsSigV4(auth, outbound, resolve);
      case AuthType.HAWK:
        return this.signHawk(auth, outbound, resolve);
      default:
        return EMPTY_RESULT;
    }
  }

  /**
   * Digest computation per RFC 7616 (with MD5 fallback per RFC 2617). We
   * don't attempt a 401 auto-challenge flow here — the user must paste the
   * `realm` / `nonce` / `opaque` values from a server challenge (or a tool
   * like curl -v) into the auth form. This matches Postman's "manual" Digest
   * mode and keeps the main-process wire protocol unchanged.
   */
  private async signDigest(
    auth: RequestAuth,
    outbound: OutboundRequest,
    resolve: (s: string) => string
  ): Promise<AuthApplyResult> {
    const d = auth.digest || {};
    const username = resolve(d.username || '');
    const password = resolve(d.password || '');
    const realm = resolve(d.realm || '');
    const nonce = resolve(d.nonce || '');
    if (!username || !realm || !nonce) return EMPTY_RESULT;

    const algorithm = (d.algorithm || 'MD5') as string;
    const qop = (d.qop || '') as string;
    const opaque = resolve(d.opaque || '');
    const nc = (d.nonceCount || '00000001').padStart(8, '0');
    const cnonce = resolve(d.clientNonce || '') || randomHex(16);
    const method = (outbound.method || 'GET').toUpperCase();
    const uri = urlPathAndQuery(outbound.url);

    const algo = algorithm.toLowerCase();
    const sess = algo.endsWith('-sess');
    const hashName = algo.startsWith('sha-256') ? 'SHA-256' : 'MD5';

    let ha1 = await hashHex(`${username}:${realm}:${password}`, hashName);
    if (sess) {
      ha1 = await hashHex(`${ha1}:${nonce}:${cnonce}`, hashName);
    }

    let ha2: string;
    if (qop === 'auth-int') {
      const bodyHash = await hashHex(outbound.body || '', hashName);
      ha2 = await hashHex(`${method}:${uri}:${bodyHash}`, hashName);
    } else {
      ha2 = await hashHex(`${method}:${uri}`, hashName);
    }

    let response: string;
    if (qop) {
      response = await hashHex(`${ha1}:${nonce}:${nc}:${cnonce}:${qop}:${ha2}`, hashName);
    } else {
      response = await hashHex(`${ha1}:${nonce}:${ha2}`, hashName);
    }

    const parts: string[] = [
      `username="${quote(username)}"`,
      `realm="${quote(realm)}"`,
      `nonce="${quote(nonce)}"`,
      `uri="${quote(uri)}"`,
      `algorithm=${algorithm}`,
      `response="${response}"`,
    ];
    if (qop) {
      parts.push(`qop=${qop}`);
      parts.push(`nc=${nc}`);
      parts.push(`cnonce="${quote(cnonce)}"`);
    }
    if (opaque) parts.push(`opaque="${quote(opaque)}"`);

    return { headers: { Authorization: `Digest ${parts.join(', ')}` }, params: {} };
  }

  /**
   * AWS Signature Version 4 (header mode by default). Based on the AWS
   * reference algorithm:
   * https://docs.aws.amazon.com/general/latest/gr/sigv4_signing.html
   *
   * Notes / limitations:
   * - We sign the current headers + x-amz-date + (optional) x-amz-security-token
   *   + host. We do NOT stream-chunked-sign; body is hashed as a single blob.
   * - Query-mode (`addTo: 'query'`) produces a presigned URL-style signature
   *   by moving everything into `X-Amz-*` query params.
   */
  private async signAwsSigV4(
    auth: RequestAuth,
    outbound: OutboundRequest,
    resolve: (s: string) => string
  ): Promise<AuthApplyResult> {
    const a = auth.awsSigV4 || {};
    const accessKey = resolve(a.accessKeyId || '');
    const secretKey = resolve(a.secretAccessKey || '');
    const sessionToken = resolve(a.sessionToken || '');
    const region = resolve(a.region || 'us-east-1') || 'us-east-1';
    const service = resolve(a.service || '') || 'execute-api';
    if (!accessKey || !secretKey) return EMPTY_RESULT;

    const addTo = a.addTo || 'header';
    let url: URL;
    try {
      url = new URL(outbound.url);
    } catch {
      return EMPTY_RESULT;
    }

    const now = new Date();
    const amzDate = iso8601Basic(now);
    const dateStamp = amzDate.slice(0, 8);
    const method = (outbound.method || 'GET').toUpperCase();
    const canonicalUri = canonicalUriPath(url.pathname || '/');
    const credentialScope = `${dateStamp}/${region}/${service}/aws4_request`;

    const signedHeaderMap = new Map<string, string>();
    signedHeaderMap.set('host', url.host);
    for (const [k, v] of Object.entries(outbound.headers || {})) {
      if (!k) continue;
      signedHeaderMap.set(k.toLowerCase(), String(v).trim());
    }

    const headerResult: Record<string, string> = {};
    const paramResult: Record<string, string> = {};
    const queryForCanonical: [string, string][] = [];
    for (const [k, v] of url.searchParams.entries()) queryForCanonical.push([k, v]);
    for (const [k, v] of Object.entries(outbound.params || {})) queryForCanonical.push([k, String(v)]);

    if (addTo === 'header') {
      signedHeaderMap.set('x-amz-date', amzDate);
      headerResult['X-Amz-Date'] = amzDate;
      if (sessionToken) {
        signedHeaderMap.set('x-amz-security-token', sessionToken);
        headerResult['X-Amz-Security-Token'] = sessionToken;
      }
    } else {
      const presignBase: Array<[string, string]> = [
        ['X-Amz-Algorithm', 'AWS4-HMAC-SHA256'],
        ['X-Amz-Credential', `${accessKey}/${credentialScope}`],
        ['X-Amz-Date', amzDate],
        ['X-Amz-Expires', '300'],
      ];
      if (sessionToken) presignBase.push(['X-Amz-Security-Token', sessionToken]);
      for (const [k, v] of presignBase) {
        queryForCanonical.push([k, v]);
        paramResult[k] = v;
      }
    }

    const signedHeaders = Array.from(signedHeaderMap.keys()).sort();
    const canonicalHeaders = signedHeaders
      .map(h => `${h}:${collapseWhitespace(signedHeaderMap.get(h) || '')}\n`)
      .join('');
    const signedHeadersList = signedHeaders.join(';');

    if (addTo === 'query') {
      queryForCanonical.push(['X-Amz-SignedHeaders', signedHeadersList]);
      paramResult['X-Amz-SignedHeaders'] = signedHeadersList;
    }

    const canonicalQuery = queryForCanonical
      .map(([k, v]) => [awsUriEncode(k, false), awsUriEncode(v, false)] as const)
      .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : 0))
      .map(([k, v]) => `${k}=${v}`)
      .join('&');

    const payloadHash = addTo === 'query'
      ? 'UNSIGNED-PAYLOAD'
      : await sha256Hex(outbound.body || '');

    const canonicalRequest = [
      method,
      canonicalUri,
      canonicalQuery,
      canonicalHeaders,
      signedHeadersList,
      payloadHash,
    ].join('\n');

    const stringToSign = [
      'AWS4-HMAC-SHA256',
      amzDate,
      credentialScope,
      await sha256Hex(canonicalRequest),
    ].join('\n');

    const signingKey = await deriveSigningKey(secretKey, dateStamp, region, service);
    const signature = toHex(new Uint8Array(await hmacSha256(signingKey, stringToSign)));

    if (addTo === 'header') {
      headerResult['Authorization'] =
        `AWS4-HMAC-SHA256 Credential=${accessKey}/${credentialScope}, ` +
        `SignedHeaders=${signedHeadersList}, Signature=${signature}`;
      if (!signedHeaderMap.has('x-amz-content-sha256') && service === 's3') {
        headerResult['X-Amz-Content-Sha256'] = payloadHash;
      }
    } else {
      paramResult['X-Amz-Signature'] = signature;
    }

    return { headers: headerResult, params: paramResult };
  }

  /**
   * Hawk signing (HTTP authentication scheme using HMAC) — header mode only.
   * Spec: https://github.com/mozilla/hawk/blob/main/API.md
   */
  private async signHawk(
    auth: RequestAuth,
    outbound: OutboundRequest,
    resolve: (s: string) => string
  ): Promise<AuthApplyResult> {
    const h = auth.hawk || {};
    const id = resolve(h.authId || '');
    const key = resolve(h.authKey || '');
    if (!id || !key) return EMPTY_RESULT;

    const algorithm = (h.algorithm || 'sha256') === 'sha1' ? 'SHA-1' : 'SHA-256';
    let url: URL;
    try {
      url = new URL(outbound.url);
    } catch {
      return EMPTY_RESULT;
    }
    const method = (outbound.method || 'GET').toUpperCase();
    const timestamp = resolve(h.timestamp || '') || Math.floor(Date.now() / 1000).toString();
    const nonce = resolve(h.nonce || '') || randomHex(6);
    const port = url.port || (url.protocol === 'https:' ? '443' : '80');
    const resource = url.pathname + (url.search || '');
    const ext = resolve(h.extData || '');
    const app = resolve(h.app || '');
    const dlg = resolve(h.delegatedBy || '');

    let hash = '';
    if (h.includePayloadHash && outbound.body) {
      const contentType = (Object.entries(outbound.headers).find(([k]) => k.toLowerCase() === 'content-type')?.[1] || '')
        .split(';')[0]
        .trim()
        .toLowerCase();
      const payloadNorm = `hawk.1.payload\n${contentType}\n${outbound.body}\n`;
      hash = toBase64(new Uint8Array(await hashBuffer(payloadNorm, algorithm)));
    }

    const normalized = [
      'hawk.1.header',
      timestamp,
      nonce,
      method,
      resource,
      url.hostname.toLowerCase(),
      port,
      hash,
      ext,
      app || '',
      dlg || '',
      '',
    ].join('\n');

    const mac = toBase64(new Uint8Array(await hmacBuffer(key, normalized, algorithm)));

    const attrs: string[] = [`id="${quote(id)}"`, `ts="${timestamp}"`, `nonce="${quote(nonce)}"`];
    if (hash) attrs.push(`hash="${hash}"`);
    if (ext) attrs.push(`ext="${quote(ext)}"`);
    attrs.push(`mac="${mac}"`);
    if (app) attrs.push(`app="${quote(app)}"`);
    if (dlg) attrs.push(`dlg="${quote(dlg)}"`);

    return { headers: { Authorization: `Hawk ${attrs.join(', ')}` }, params: {} };
  }
}

function quote(v: string): string {
  return String(v).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

function urlPathAndQuery(raw: string): string {
  try {
    const u = new URL(raw);
    return (u.pathname || '/') + (u.search || '');
  } catch {
    return raw || '/';
  }
}

function iso8601Basic(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return (
    d.getUTCFullYear().toString() +
    pad(d.getUTCMonth() + 1) +
    pad(d.getUTCDate()) +
    'T' +
    pad(d.getUTCHours()) +
    pad(d.getUTCMinutes()) +
    pad(d.getUTCSeconds()) +
    'Z'
  );
}

function canonicalUriPath(path: string): string {
  if (!path) return '/';
  return path
    .split('/')
    .map(seg => awsUriEncode(decodeSafe(seg), false))
    .join('/');
}

function decodeSafe(s: string): string {
  try { return decodeURIComponent(s); } catch { return s; }
}

function awsUriEncode(str: string, encodeSlash: boolean): string {
  let out = '';
  for (const ch of str) {
    if (
      (ch >= 'A' && ch <= 'Z') ||
      (ch >= 'a' && ch <= 'z') ||
      (ch >= '0' && ch <= '9') ||
      ch === '_' ||
      ch === '-' ||
      ch === '~' ||
      ch === '.'
    ) {
      out += ch;
    } else if (ch === '/') {
      out += encodeSlash ? '%2F' : '/';
    } else {
      const bytes = new TextEncoder().encode(ch);
      for (const b of bytes) out += '%' + b.toString(16).toUpperCase().padStart(2, '0');
    }
  }
  return out;
}

function collapseWhitespace(s: string): string {
  return s.replace(/\s+/g, ' ').trim();
}

function randomHex(len: number): string {
  const bytes = new Uint8Array(len);
  crypto.getRandomValues(bytes);
  return toHex(bytes);
}

function toHex(buf: Uint8Array): string {
  let s = '';
  for (const b of buf) s += b.toString(16).padStart(2, '0');
  return s;
}

function toBase64(buf: Uint8Array): string {
  let bin = '';
  for (const b of buf) bin += String.fromCharCode(b);
  return btoa(bin);
}

async function hashBuffer(input: string, algo: string): Promise<ArrayBuffer> {
  return crypto.subtle.digest(algo, new TextEncoder().encode(input));
}

async function hashHex(input: string, algo: string): Promise<string> {
  if (algo === 'MD5') return md5Hex(input);
  return toHex(new Uint8Array(await hashBuffer(input, algo)));
}

async function sha256Hex(input: string): Promise<string> {
  return toHex(new Uint8Array(await hashBuffer(input, 'SHA-256')));
}

async function hmacBuffer(key: string | ArrayBuffer, data: string, algo: string): Promise<ArrayBuffer> {
  const keyBuf = typeof key === 'string' ? new TextEncoder().encode(key) : new Uint8Array(key);
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    keyBuf,
    { name: 'HMAC', hash: algo },
    false,
    ['sign']
  );
  return crypto.subtle.sign('HMAC', cryptoKey, new TextEncoder().encode(data));
}

async function hmacSha256(key: string | ArrayBuffer, data: string): Promise<ArrayBuffer> {
  return hmacBuffer(key, data, 'SHA-256');
}

async function deriveSigningKey(secret: string, dateStamp: string, region: string, service: string): Promise<ArrayBuffer> {
  const kDate = await hmacSha256(`AWS4${secret}`, dateStamp);
  const kRegion = await hmacSha256(kDate, region);
  const kService = await hmacSha256(kRegion, service);
  return hmacSha256(kService, 'aws4_request');
}

/**
 * Pure-JS MD5 for Digest auth fallback. Subtle crypto does not expose MD5 in
 * browsers/Electron, and we can't pull in a native dep just for this. This is
 * a compact and readable reference implementation.
 */
function md5Hex(input: string): string {
  const msg = new TextEncoder().encode(input);
  const msgLenBits = BigInt(msg.length) * 8n;

  const padLen = (56 - ((msg.length + 1) % 64) + 64) % 64;
  const padded = new Uint8Array(msg.length + 1 + padLen + 8);
  padded.set(msg, 0);
  padded[msg.length] = 0x80;
  const dv = new DataView(padded.buffer);
  dv.setUint32(padded.length - 8, Number(msgLenBits & 0xffffffffn), true);
  dv.setUint32(padded.length - 4, Number((msgLenBits >> 32n) & 0xffffffffn), true);

  const s = [
    7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22,
    5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20,
    4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23,
    6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21,
  ];
  const K = [
    0xd76aa478, 0xe8c7b756, 0x242070db, 0xc1bdceee,
    0xf57c0faf, 0x4787c62a, 0xa8304613, 0xfd469501,
    0x698098d8, 0x8b44f7af, 0xffff5bb1, 0x895cd7be,
    0x6b901122, 0xfd987193, 0xa679438e, 0x49b40821,
    0xf61e2562, 0xc040b340, 0x265e5a51, 0xe9b6c7aa,
    0xd62f105d, 0x02441453, 0xd8a1e681, 0xe7d3fbc8,
    0x21e1cde6, 0xc33707d6, 0xf4d50d87, 0x455a14ed,
    0xa9e3e905, 0xfcefa3f8, 0x676f02d9, 0x8d2a4c8a,
    0xfffa3942, 0x8771f681, 0x6d9d6122, 0xfde5380c,
    0xa4beea44, 0x4bdecfa9, 0xf6bb4b60, 0xbebfbc70,
    0x289b7ec6, 0xeaa127fa, 0xd4ef3085, 0x04881d05,
    0xd9d4d039, 0xe6db99e5, 0x1fa27cf8, 0xc4ac5665,
    0xf4292244, 0x432aff97, 0xab9423a7, 0xfc93a039,
    0x655b59c3, 0x8f0ccc92, 0xffeff47d, 0x85845dd1,
    0x6fa87e4f, 0xfe2ce6e0, 0xa3014314, 0x4e0811a1,
    0xf7537e82, 0xbd3af235, 0x2ad7d2bb, 0xeb86d391,
  ];

  let a0 = 0x67452301, b0 = 0xefcdab89, c0 = 0x98badcfe, d0 = 0x10325476;
  const words = new Uint32Array(16);

  for (let off = 0; off < padded.length; off += 64) {
    for (let i = 0; i < 16; i++) {
      words[i] = dv.getUint32(off + i * 4, true);
    }
    let A = a0, B = b0, C = c0, D = d0;
    for (let i = 0; i < 64; i++) {
      let f: number, g: number;
      if (i < 16) { f = (B & C) | (~B & D); g = i; }
      else if (i < 32) { f = (D & B) | (~D & C); g = (5 * i + 1) % 16; }
      else if (i < 48) { f = B ^ C ^ D; g = (3 * i + 5) % 16; }
      else { f = C ^ (B | ~D); g = (7 * i) % 16; }
      f = (f + A + K[i] + words[g]) >>> 0;
      A = D;
      D = C;
      C = B;
      B = (B + rotl32(f, s[i])) >>> 0;
    }
    a0 = (a0 + A) >>> 0;
    b0 = (b0 + B) >>> 0;
    c0 = (c0 + C) >>> 0;
    d0 = (d0 + D) >>> 0;
  }

  const out = new Uint8Array(16);
  const odv = new DataView(out.buffer);
  odv.setUint32(0, a0, true);
  odv.setUint32(4, b0, true);
  odv.setUint32(8, c0, true);
  odv.setUint32(12, d0, true);
  return toHex(out);
}

function rotl32(x: number, n: number): number {
  return ((x << n) | (x >>> (32 - n))) >>> 0;
}
