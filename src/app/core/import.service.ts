import { Injectable } from '@angular/core';
import { Collection, Folder } from '@models/collection';
import { Request, HttpMethod, Script, HttpHeader, HttpParameter, RequestBody, UrlencodedField, FormDataField } from '@models/request';
import { v4 as uuidv4 } from 'uuid';
import * as yaml from 'js-yaml';
import { pruneEmptyKv } from './kv-utils';

@Injectable({
    providedIn: 'root'
})
export class ImportService {

    constructor() { }

    /**
     * Parse a raw cURL command into a Request. Supports the common flags:
     * -X/--request, -H/--header, -d/--data[-raw|-binary|-urlencode],
     * -F/--form, -u/--user, --compressed, --location, -k/--insecure,
     * and a bare URL (first positional arg).
     *
     * This is a focused parser — it handles real-world Postman/DevTools/GitHub
     * examples but intentionally leaves the exotic corners to the user.
     */
    importCurl(curl: string): Request {
        const tokens = tokenizeCurl(curl);
        if (!tokens.length) throw new Error('Empty cURL command');
        if (tokens[0].toLowerCase() !== 'curl') {
        } else {
            tokens.shift();
        }

        let method: string | undefined;
        let url = '';
        const headers: HttpHeader[] = [];
        const dataParts: string[] = [];
        const dataRawParts: string[] = [];
        const urlencodeParts: Array<{ key: string; value: string }> = [];
        const formParts: FormDataField[] = [];
        let basicAuth: { user: string; password: string } | undefined;

        for (let i = 0; i < tokens.length; i++) {
            const t = tokens[i];
            const next = () => tokens[++i];

            if (t === '-X' || t === '--request') {
                method = (next() || '').toUpperCase();
            } else if (t === '-H' || t === '--header') {
                const raw = next() || '';
                const idx = raw.indexOf(':');
                if (idx > 0) {
                    headers.push({
                        key: raw.slice(0, idx).trim(),
                        value: raw.slice(idx + 1).trim(),
                        enabled: true
                    });
                }
            } else if (t === '-d' || t === '--data' || t === '--data-ascii' || t === '--data-binary') {
                dataParts.push(next() || '');
            } else if (t === '--data-raw') {
                dataRawParts.push(next() || '');
            } else if (t === '--data-urlencode') {
                const raw = next() || '';
                const eq = raw.indexOf('=');
                if (eq >= 0) {
                    urlencodeParts.push({ key: raw.slice(0, eq), value: raw.slice(eq + 1) });
                } else {
                    urlencodeParts.push({ key: raw, value: '' });
                }
            } else if (t === '-F' || t === '--form') {
                const raw = next() || '';
                const eq = raw.indexOf('=');
                if (eq < 0) continue;
                const key = raw.slice(0, eq);
                const value = raw.slice(eq + 1);
                if (value.startsWith('@')) {
                    formParts.push({ key, type: 'file', filePath: value.slice(1), enabled: true });
                } else {
                    formParts.push({ key, type: 'text', value, enabled: true });
                }
            } else if (t === '-u' || t === '--user') {
                const cred = next() || '';
                const colon = cred.indexOf(':');
                basicAuth = colon >= 0
                    ? { user: cred.slice(0, colon), password: cred.slice(colon + 1) }
                    : { user: cred, password: '' };
            } else if (t === '--url') {
                url = next() || url;
            } else if (t === '-G' || t === '--get') {
                method = 'GET';
            } else if (t === '--compressed' || t === '--location' || t === '-L' || t === '-k' || t === '--insecure' || t === '-s' || t === '--silent' || t === '-I' || t === '--head' || t === '-v' || t === '--verbose') {
                if (t === '-I' || t === '--head') method = 'HEAD';
            } else if (t.startsWith('-')) {
                if (next === undefined) {  }
                const nv = tokens[i + 1];
                if (nv && !nv.startsWith('-') && !url) {
                }
            } else if (!url) {
                url = t;
            }
        }

        const body: RequestBody | undefined = buildBodyFromCurlParts(dataParts, dataRawParts, urlencodeParts, formParts);

        const resolvedMethod = method ?? (body && body.mode !== 'none' ? 'POST' : 'GET');

        if (basicAuth) {
            const encoded = btoa(`${basicAuth.user}:${basicAuth.password}`);
            if (!headers.some(h => (h.key || '').toLowerCase() === 'authorization')) {
                headers.push({ key: 'Authorization', value: `Basic ${encoded}`, enabled: true });
            }
        }

        const request: Request = {
            id: uuidv4(),
            title: url || 'Imported cURL',
            url,
            httpMethod: this.parsePostmanMethod(resolvedMethod),
            httpHeaders: headers,
            httpParameters: [],
            requestBody: body?.raw || '',
            body,
            script: { preRequest: '', postRequest: '' }
        };
        return request;
    }

    importPostmanCollection(content: string): Collection {
        const json = this.parseContent(content);
        const info = json.info || {};
        const collectionTitle = info.name || 'Imported Postman Collection';

        const collection: Collection = {
            id: uuidv4(),
            title: collectionTitle,
            order: 0,
            requests: [],
            folders: []
        };

        const rootFolder: Folder = {
            id: uuidv4(),
            title: collectionTitle,
            order: 0,
            requests: [],
            folders: [],
            variables: this.parsePostmanVariables(json.variable),
            script: this.parsePostmanScripts(json.event),
            httpHeaders: this.convertPostmanAuthToHeaders(json.auth)
        };
        collection.folders.push(rootFolder);

        if (json.item) {
            json.item.forEach((item: any) => {
                this.processPostmanItem(item, rootFolder);
            });
        }

        return collection;
    }

    private processPostmanItem(item: any, parent: Collection | Folder) {
        if (item.item) {

            const folder: Folder = {
                id: uuidv4(),
                title: item.name || 'New Folder',
                order: parent.folders.length,
                requests: [],
                folders: [],
                variables: [],
                script: { preRequest: '', postRequest: '' },
                httpHeaders: this.convertPostmanAuthToHeaders(item.auth)
            };

            item.item.forEach((subItem: any) => {
                this.processPostmanItem(subItem, folder);
            });

            parent.folders.push(folder);
        } else if (item.request) {

            const req = item.request;
            const request: Request = {
                id: uuidv4(),
                title: item.name || 'New Request',
                url: this.parsePostmanUrl(req.url),
                httpMethod: this.parsePostmanMethod(req.method),
                httpHeaders: [
                    ...this.parsePostmanHeaders(req.header),
                    ...this.convertPostmanAuthToHeaders(req.auth)
                ],
                httpParameters: this.parsePostmanQueryParams(req.url?.query),
                requestBody: this.parsePostmanBody(req.body),
                body: this.parsePostmanStructuredBody(req.body),
                script: this.parsePostmanScripts(item.event),
                order: parent.requests.length
            };

            parent.requests.push(request);
        }
    }

    private parsePostmanUrl(url: any): string {
        if (typeof url === 'string') return url;
        return url?.raw || '';
    }

    private parsePostmanMethod(method: string): HttpMethod {
        if (!method) return HttpMethod.GET;
        const m = method.toUpperCase();
        switch (m) {
            case 'GET': return HttpMethod.GET;
            case 'POST': return HttpMethod.POST;
            case 'PUT': return HttpMethod.PUT;
            case 'PATCH': return HttpMethod.PATCH;
            case 'DELETE': return HttpMethod.DELETE;
            case 'HEAD': return HttpMethod.HEAD;
            case 'OPTIONS': return HttpMethod.OPTIONS;
            default: return HttpMethod.GET;
        }
    }

    private parsePostmanHeaders(headers: any[]): HttpHeader[] {
        if (!headers) return [];
        return pruneEmptyKv(headers.map(h => ({
            key: h.key,
            value: h.value,
            description: h.description
        })));
    }

    private parsePostmanQueryParams(query: any[]): HttpParameter[] {
        if (!query) return [];
        return pruneEmptyKv(query.map(q => ({
            key: q.key,
            value: q.value,
            description: q.description
        })));
    }

    private parsePostmanBody(body: any): string {
        if (!body) return '';
        if (body.mode === 'raw') return body.raw || '';
        if (body.mode === 'urlencoded') {
            return (body.urlencoded || [])
                .filter((p: any) => p && typeof p.key === 'string' && p.key.trim() !== '')
                .map((p: any) => `${p.key.trim()}=${p.value ?? ''}`)
                .join('&');
        }
        return '';
    }

    /** Map Postman's `body` shape to our RequestBody envelope. */
    private parsePostmanStructuredBody(body: any) {
        if (!body) return undefined;
        if (body.mode === 'raw') {
            const lang = (body.options?.raw?.language || '').toLowerCase();
            const mode = lang === 'xml' ? 'xml' : (lang === 'json' ? 'json' : 'text');
            return { mode, raw: body.raw || '' } as const;
        }
        if (body.mode === 'urlencoded') {
            return {
                mode: 'urlencoded' as const,
                urlencoded: (body.urlencoded || [])
                    .filter((p: any) => p && typeof p.key === 'string')
                    .map((p: any) => ({
                        key: p.key,
                        value: p.value ?? '',
                        enabled: p.disabled !== true,
                        description: p.description
                    }))
            };
        }
        if (body.mode === 'formdata') {
            return {
                mode: 'form-data' as const,
                form: (body.formdata || [])
                    .filter((p: any) => p && typeof p.key === 'string')
                    .map((p: any) => ({
                        key: p.key,
                        type: (p.type === 'file') ? 'file' as const : 'text' as const,
                        value: p.type === 'file' ? undefined : (p.value ?? ''),
                        filePath: p.type === 'file' && typeof p.src === 'string' ? p.src : undefined,
                        contentType: p.contentType,
                        enabled: p.disabled !== true,
                        description: p.description
                    }))
            };
        }
        if (body.mode === 'file' && body.file) {
            return {
                mode: 'binary' as const,
                binary: {
                    filePath: typeof body.file === 'string' ? body.file : (body.file.src || ''),
                    contentType: body.file.contentType
                }
            };
        }
        if (body.mode === 'graphql') {
            const g = body.graphql || {};
            return {
                mode: 'graphql' as const,
                raw: typeof g === 'string' ? g : JSON.stringify({ query: g.query || '', variables: g.variables || {} })
            };
        }
        return undefined;
    }

    private parsePostmanScripts(events: any[]): Script {
        const scripts: Script = { preRequest: '', postRequest: '' };
        if (!events) return scripts;

        events.forEach(event => {
            if (event.listen === 'prerequest' && event.script?.exec) {
                scripts.preRequest = event.script.exec.join('\n');
            } else if (event.listen === 'test' && event.script?.exec) {
                scripts.postRequest = event.script.exec.join('\n');
            }
        });

        return scripts;
    }

    private parsePostmanVariables(variables: any[]): { key: string; value: string; description?: string }[] {
        if (!variables) return [];
        return pruneEmptyKv(variables.map(v => ({
            key: v.key,
            value: v.value,
            description: v.description
        })));
    }

    importOpenApi(content: string): Collection {
        const json = this.parseContent(content);
        const info = json.info || {};
        const collection: Collection = {
            id: uuidv4(),
            title: info.title || 'Imported OpenAPI',
            order: 0,
            requests: [],
            folders: []
        };

        const paths = json.paths || {};
        Object.keys(paths).forEach(pathStr => {
            const pathValue = paths[pathStr];
            Object.keys(pathValue).forEach(methodStr => {
                if (['get', 'post', 'put', 'patch', 'delete', 'head', 'options'].includes(methodStr.toLowerCase())) {
                    const operation = pathValue[methodStr];
                    const request: Request = {
                        id: uuidv4(),
                        title: operation.summary || operation.operationId || `${methodStr.toUpperCase()} ${pathStr}`,
                        url: `{{baseUrl}}${pathStr}`,
                        httpMethod: this.parsePostmanMethod(methodStr),
                        httpHeaders: this.parseOpenApiHeaders(operation.parameters),
                        httpParameters: this.parseOpenApiQueryParams(operation.parameters),
                        requestBody: this.parseOpenApiBody(operation.requestBody),
                        script: { preRequest: '', postRequest: '' },
                        order: collection.requests.length
                    };
                    collection.requests.push(request);
                }
            });
        });

        return collection;
    }

    private parseOpenApiHeaders(parameters: any[]): HttpHeader[] {
        if (!parameters) return [];
        return pruneEmptyKv(parameters
            .filter(p => p.in === 'header')
            .map(p => ({
                key: p.name,
                value: p.example || (p.schema?.default !== undefined ? String(p.schema.default) : ''),
                description: p.description
            })));
    }

    private parseOpenApiQueryParams(parameters: any[]): HttpParameter[] {
        if (!parameters) return [];
        return pruneEmptyKv(parameters
            .filter(p => p.in === 'query')
            .map(p => ({
                key: p.name,
                value: p.example || (p.schema?.default !== undefined ? String(p.schema.default) : ''),
                description: p.description
            })));
    }

    private parseOpenApiBody(requestBody: any): string {
        if (!requestBody || !requestBody.content) return '';
        const content = requestBody.content;
        const jsonContent = content['application/json'];
        if (jsonContent && jsonContent.example) {
            return typeof jsonContent.example === 'string'
                ? jsonContent.example
                : JSON.stringify(jsonContent.example, null, 2);
        }

        return '';
    }

    private parseContent(content: string): any {
        if (typeof content !== 'string') return content;
        try {

            return JSON.parse(content);
        } catch (e) {
            try {

                return yaml.load(content);
            } catch (ye) {
                throw new Error('Failed to parse content as JSON or YAML');
            }
        }
    }
    private convertPostmanAuthToHeaders(auth: any): HttpHeader[] {
        if (!auth || !auth.type) return [];
        const headers: HttpHeader[] = [];

        if (auth.type === 'bearer') {
            const token = this.findAuthParam(auth.bearer, 'token');
            if (token) {
                headers.push({ key: 'Authorization', value: `Bearer ${token}`, description: 'Auto-generated from Postman Auth' });
            }
        } else if (auth.type === 'basic') {
            const username = this.findAuthParam(auth.basic, 'username');
            const password = this.findAuthParam(auth.basic, 'password');
            if (username || password) {
                const creds = btoa(`${username}:${password}`);
                headers.push({ key: 'Authorization', value: `Basic ${creds}`, description: 'Auto-generated from Postman Auth' });
            }
        } else if (auth.type === 'apikey') {
            const key = this.findAuthParam(auth.apikey, 'key');
            const value = this.findAuthParam(auth.apikey, 'value');
            const inWhere = this.findAuthParam(auth.apikey, 'in');
            if (key && value && inWhere === 'header') {
                headers.push({ key: key, value: value, description: 'Auto-generated from Postman Auth' });
            }
        }
        return headers;
    }

    private findAuthParam(params: any[], key: string): string {
        if (!Array.isArray(params)) return '';
        const param = params.find(p => p.key === key);
        return param ? param.value : '';
    }

    exportCollection(collection: Collection): string {
        const postmanCollection = {
            info: {
                _postman_id: collection.id,
                name: collection.title,
                schema: "https://schema.getpostman.com/json/collection/v2.1.0/collection.json"
            },
            item: this.buildPostmanItems(collection)
        };
        return JSON.stringify(postmanCollection, null, 2);
    }

    private buildPostmanItems(parent: Collection | Folder): any[] {
        const items: any[] = [];

        (parent.folders || []).forEach(f => {
            items.push({
                name: f.title,
                item: this.buildPostmanItems(f),
                event: this.convertToPostmanEvents(f.script)
            });
        });

        (parent.requests || []).forEach(r => {
            items.push({
                name: r.title,
                request: {
                    method: HttpMethod[r.httpMethod],
                    header: (r.httpHeaders || []).map(h => ({
                        key: h.key,
                        value: h.value,
                        description: h.description,
                        disabled: !h.enabled
                    })),
                    url: {
                        raw: r.url,
                        query: (r.httpParameters || [])
                            .filter(p => p.type !== 'path')
                            .map(p => ({
                                key: p.key,
                                value: p.value,
                                disabled: !p.enabled
                            }))
                    },
                    body: r.requestBody ? {
                        mode: 'raw',
                        raw: r.requestBody
                    } : undefined
                },
                event: this.convertToPostmanEvents(r.script)
            });
        });

        return items;
    }

    private convertToPostmanEvents(script?: Script): any[] {
        if (!script) return [];
        const events: any[] = [];
        if (script.preRequest) {
            events.push({
                listen: 'prerequest',
                script: { exec: script.preRequest.split('\n'), type: 'text/javascript' }
            });
        }
        if (script.postRequest) {
            events.push({
                listen: 'test',
                script: { exec: script.postRequest.split('\n'), type: 'text/javascript' }
            });
        }
        return events;
    }

    /**
     * Import Chrome / Firefox HAR. Caps at 500 entries.
     */
    importHar(content: string | object): Collection {
        const j = typeof content === 'string' ? this.parseContent(content) : content;
        const log = (j as { log?: { entries?: unknown } })?.log;
        const entries = log?.entries;
        if (!Array.isArray(entries)) {
            throw new Error('Invalid HAR: expected log.entries');
        }
        const requests: Request[] = [];
        const max = Math.min(entries.length, 500);
        for (let i = 0; i < max; i++) {
            const e = (entries as any[])[i];
            const req = e?.request;
            if (!req) continue;
            const urlStr =
                typeof req.url === 'string'
                    ? req.url
                    : (req.url && (req.url as { raw?: string }).raw) || '';
            if (!urlStr) continue;
            const m = (req.method || 'GET').toString().toUpperCase();
            const method = this.parsePostmanMethod(m);
            const headers: HttpHeader[] = (Array.isArray(req.headers) ? req.headers : [])
                .filter((h: { name?: string }) => h?.name && !String(h.name).startsWith(':'))
                .map((h: { name: string; value: string }) => ({
                    key: h.name,
                    value: h.value,
                    enabled: true,
                }));
            const body = req.postData?.text || '';
            const request: Request = {
                id: uuidv4(),
                title: (e as { comment?: string }).comment || urlStr.substring(0, 96) || `HAR ${i + 1}`,
                url: urlStr,
                httpMethod: method,
                httpHeaders: headers,
                httpParameters: [],
                requestBody: body,
                body: body ? ({ mode: 'text' as const, raw: body }) : undefined,
                script: { preRequest: '', postRequest: '' },
                order: requests.length,
            };
            requests.push(request);
        }
        if (!requests.length) {
            throw new Error('No usable entries in HAR');
        }
        return {
            id: uuidv4(),
            order: 0,
            title: 'Imported HAR',
            requests,
            folders: [],
        };
    }

    /**
     * Insomnia export format 4: flat list of `request` resources.
     */
    importInsomniaExport(content: string | object): Collection {
        const j = typeof content === 'string' ? this.parseContent(content) : content;
        if ((j as { __export_format?: number }).__export_format !== 4) {
            throw new Error('Unsupported Insomnia export (expected format 4)');
        }
        const resources = (j as { resources?: any[] })?.resources;
        if (!Array.isArray(resources)) {
            throw new Error('Invalid Insomnia export: resources');
        }
        const requests: Request[] = [];
        for (const r of resources) {
            if (r._type !== 'request') {
                continue;
            }
            const url = (r.url || '') as string;
            if (!url) {
                continue;
            }
            const m = (r.method || 'GET').toString();
            const request: Request = {
                id: r._id && typeof r._id === 'string' ? r._id : uuidv4(),
                title: (r.name as string) || url.substring(0, 80),
                url,
                httpMethod: this.parsePostmanMethod(m),
                httpHeaders: (Array.isArray(r.headers) ? r.headers : []).map((h: any) => ({
                    key: h.name,
                    value: h.value,
                    enabled: h.disabled !== true,
                })),
                httpParameters: [],
                requestBody: (r.body && (r.body as { text?: string }).text) || '',
                body: r.body && (r.body as { text?: string }).text
                    ? { mode: 'text' as const, raw: (r.body as { text: string }).text }
                    : undefined,
                script: { preRequest: '', postRequest: '' },
                order: requests.length,
            };
            requests.push(request);
        }
        if (!requests.length) {
            throw new Error('No request resources in Insomnia export');
        }
        return {
            id: uuidv4(),
            order: 0,
            title: 'Imported Insomnia',
            requests,
            folders: [],
        };
    }
}

/**
 * Tokenize a shell-ish cURL command. Handles single quotes, double quotes,
 * backslash line continuations and standard whitespace. Not a full POSIX
 * shell parser but covers everything cURL examples actually emit.
 */
export function tokenizeCurl(input: string): string[] {
    const src = (input || '').trim();
    const out: string[] = [];
    let i = 0;
    let buf = '';
    let quote: '\'' | '"' | null = null;

    const flush = () => {
        if (buf.length > 0) {
            out.push(buf);
            buf = '';
        }
    };

    while (i < src.length) {
        const ch = src[i];

        if (quote) {
            if (ch === '\\' && quote === '"' && i + 1 < src.length) {
                buf += src[i + 1];
                i += 2;
                continue;
            }
            if (ch === quote) {
                quote = null;
                i++;
                continue;
            }
            buf += ch;
            i++;
            continue;
        }

        if (ch === '\\' && i + 1 < src.length) {
            const nx = src[i + 1];
            if (nx === '\n' || nx === '\r') {
                i += 2;
                if (src[i] === '\n' && nx === '\r') i++;
                continue;
            }
            buf += nx;
            i += 2;
            continue;
        }
        if (ch === '\'' || ch === '"') {
            quote = ch as '\'' | '"';
            i++;
            continue;
        }
        if (/\s/.test(ch)) {
            flush();
            i++;
            continue;
        }
        buf += ch;
        i++;
    }
    flush();
    return out;
}

/**
 * Build a RequestBody from raw cURL data parts. Precedence:
 *   - form parts win → form-data
 *   - urlencode parts win → urlencoded
 *   - data-raw / data parts → raw text (newline-joined when multiple)
 */
export function buildBodyFromCurlParts(
    dataParts: string[],
    dataRawParts: string[],
    urlencodeParts: Array<{ key: string; value: string }>,
    formParts: FormDataField[]
): RequestBody | undefined {
    if (formParts.length) {
        return { mode: 'form-data', form: formParts };
    }
    if (urlencodeParts.length) {
        const fields: UrlencodedField[] = urlencodeParts.map(p => ({
            key: p.key,
            value: p.value,
            enabled: true
        }));
        return { mode: 'urlencoded', urlencoded: fields };
    }
    const raw = [...dataParts, ...dataRawParts].join('&');
    if (!raw) return undefined;
    try {
        JSON.parse(raw);
        return { mode: 'json', raw };
    } catch {
        return { mode: 'text', raw };
    }
}

