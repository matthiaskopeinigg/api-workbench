import { Injectable } from '@angular/core';
import { Request, HttpHeader, HttpMethod } from '@models/request';
import { hasKey } from './kv-utils';

/** Language identifier for the code-editor syntax highlighter. */
export type SnippetEditorLang = 'plain' | 'javascript' | 'python' | 'go' | 'ruby' | 'java' | 'csharp' | 'php';

/**
 * Contract for a single snippet generator. A generator is a pure function from
 * the current Request to a code string; the dialog renders one tab per
 * registered generator.
 */
export interface SnippetGenerator {
  id: string;
  label: string;
  editorLang: SnippetEditorLang;
  generate(request: Request): string;
}

/** Helpers shared by most generators. Kept private to the service. */
function activeHeaders(request: Request): HttpHeader[] {
  return (request.httpHeaders || []).filter(h => h.enabled !== false && hasKey(h));
}

function methodOf(request: Request): string {
  return HttpMethod[request.httpMethod];
}

function headerMap(request: Request): Record<string, string> {
  return activeHeaders(request).reduce<Record<string, string>>((acc, h) => {
    acc[(h.key || '').trim()] = h.value || '';
    return acc;
  }, {});
}

function hasBody(request: Request): boolean {
  const m = methodOf(request);
  return !!request.requestBody && m !== 'GET' && m !== 'HEAD';
}

function bodyString(request: Request): string {
  return request.requestBody || '';
}

/** Escape a string for embedding in a single-quoted shell argument. */
function shellEscape(value: string): string {
  return value.replace(/'/g, "'\\''");
}

/** Escape for a Go / C# / Java double-quoted string literal. */
function doubleQuoteEscape(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n');
}

const curl: SnippetGenerator = {
  id: 'curl',
  label: 'cURL',
  editorLang: 'plain',
  generate(r) {
    let s = `curl --location --request ${methodOf(r)} '${r.url}'`;
    activeHeaders(r).forEach(h => {
      s += ` \\\n--header '${(h.key || '').trim()}: ${h.value || ''}'`;
    });
    if (hasBody(r)) s += ` \\\n--data-raw '${shellEscape(bodyString(r))}'`;
    return s;
  }
};

const httpie: SnippetGenerator = {
  id: 'httpie',
  label: 'HTTPie',
  editorLang: 'plain',
  generate(r) {
    let s = `http ${methodOf(r)} '${r.url}'`;
    activeHeaders(r).forEach(h => {
      s += ` \\\n  '${(h.key || '').trim()}:${h.value || ''}'`;
    });
    if (hasBody(r)) s += ` \\\n  <<< '${shellEscape(bodyString(r))}'`;
    return s;
  }
};

const nodeFetch: SnippetGenerator = {
  id: 'fetch',
  label: 'Node / Fetch',
  editorLang: 'javascript',
  generate(r) {
    const opts: Record<string, unknown> = {
      method: methodOf(r),
      headers: headerMap(r)
    };
    if (hasBody(r)) opts['body'] = bodyString(r);
    return [
      `fetch("${r.url}", ${JSON.stringify(opts, null, 2)})`,
      '  .then(r => r.text())',
      '  .then(console.log)',
      '  .catch(console.error);'
    ].join('\n');
  }
};

const nodeAxios: SnippetGenerator = {
  id: 'axios',
  label: 'Node / Axios',
  editorLang: 'javascript',
  generate(r) {
    const cfg: Record<string, unknown> = {
      method: methodOf(r).toLowerCase(),
      url: r.url,
      headers: headerMap(r)
    };
    if (hasBody(r)) cfg['data'] = bodyString(r);
    return [
      `import axios from "axios";`,
      ``,
      `axios(${JSON.stringify(cfg, null, 2)})`,
      `  .then(res => console.log(res.data))`,
      `  .catch(err => console.error(err));`
    ].join('\n');
  }
};

const python: SnippetGenerator = {
  id: 'python',
  label: 'Python / requests',
  editorLang: 'python',
  generate(r) {
    const method = methodOf(r).toUpperCase();
    const headers = headerMap(r);
    const lines = [
      `import requests`,
      ``,
      `url = "${r.url}"`,
      `headers = ${JSON.stringify(headers, null, 2)}`,
    ];
    if (hasBody(r)) {
      lines.push(`payload = ${JSON.stringify(bodyString(r))}`);
      lines.push(``);
      lines.push(`response = requests.request("${method}", url, headers=headers, data=payload)`);
    } else {
      lines.push(``);
      lines.push(`response = requests.request("${method}", url, headers=headers)`);
    }
    lines.push(`print(response.text)`);
    return lines.join('\n');
  }
};

const go: SnippetGenerator = {
  id: 'go',
  label: 'Go / net/http',
  editorLang: 'go',
  generate(r) {
    const method = methodOf(r);
    const hdrs = activeHeaders(r)
      .map(h => `\treq.Header.Add("${doubleQuoteEscape((h.key || '').trim())}", "${doubleQuoteEscape(h.value || '')}")`)
      .join('\n');
    const bodyLine = hasBody(r)
      ? `\tpayload := strings.NewReader(\`${bodyString(r).replace(/`/g, '` + "`" + `')}\`)\n`
      : '';
    const bodyArg = hasBody(r) ? 'payload' : 'nil';
    return [
      `package main`,
      ``,
      `import (`,
      `\t"fmt"`,
      `\t"io"`,
      `\t"net/http"`,
      ...(hasBody(r) ? [`\t"strings"`] : []),
      `)`,
      ``,
      `func main() {`,
      `\turl := "${doubleQuoteEscape(r.url)}"`,
      bodyLine + `\treq, _ := http.NewRequest("${method}", url, ${bodyArg})`,
      hdrs,
      `\tres, err := http.DefaultClient.Do(req)`,
      `\tif err != nil { panic(err) }`,
      `\tdefer res.Body.Close()`,
      `\tbody, _ := io.ReadAll(res.Body)`,
      `\tfmt.Println(string(body))`,
      `}`
    ].filter(Boolean).join('\n');
  }
};

const ruby: SnippetGenerator = {
  id: 'ruby',
  label: 'Ruby / Net::HTTP',
  editorLang: 'ruby',
  generate(r) {
    const method = methodOf(r);
    const klass = `Net::HTTP::${method.charAt(0) + method.slice(1).toLowerCase()}`;
    const lines = [
      `require 'net/http'`,
      `require 'uri'`,
      ``,
      `url = URI("${r.url}")`,
      `http = Net::HTTP.new(url.host, url.port)`,
      `http.use_ssl = (url.scheme == "https")`,
      ``,
      `request = ${klass}.new(url)`
    ];
    activeHeaders(r).forEach(h => {
      lines.push(`request["${doubleQuoteEscape((h.key || '').trim())}"] = "${doubleQuoteEscape(h.value || '')}"`);
    });
    if (hasBody(r)) {
      lines.push(`request.body = ${JSON.stringify(bodyString(r))}`);
    }
    lines.push(``);
    lines.push(`response = http.request(request)`);
    lines.push(`puts response.read_body`);
    return lines.join('\n');
  }
};

const javaOkhttp: SnippetGenerator = {
  id: 'java-okhttp',
  label: 'Java / OkHttp',
  editorLang: 'java',
  generate(r) {
    const method = methodOf(r);
    const lines = [
      `OkHttpClient client = new OkHttpClient();`,
      ``,
    ];
    if (hasBody(r)) {
      lines.push(`MediaType mediaType = MediaType.parse("application/json");`);
      lines.push(`RequestBody body = RequestBody.create(mediaType, ${JSON.stringify(bodyString(r))});`);
    }
    lines.push(`Request request = new Request.Builder()`);
    lines.push(`  .url("${doubleQuoteEscape(r.url)}")`);
    const bodyArg = hasBody(r) ? 'body' : '';
    lines.push(`  .method("${method}", ${bodyArg})`);
    activeHeaders(r).forEach(h => {
      lines.push(`  .addHeader("${doubleQuoteEscape((h.key || '').trim())}", "${doubleQuoteEscape(h.value || '')}")`);
    });
    lines.push(`  .build();`);
    lines.push(``);
    lines.push(`Response response = client.newCall(request).execute();`);
    lines.push(`System.out.println(response.body().string());`);
    return lines.join('\n');
  }
};

const csharp: SnippetGenerator = {
  id: 'csharp',
  label: 'C# / RestSharp',
  editorLang: 'csharp',
  generate(r) {
    const method = methodOf(r).charAt(0) + methodOf(r).slice(1).toLowerCase();
    const lines = [
      `var client = new RestClient("${doubleQuoteEscape(r.url)}");`,
      `var request = new RestRequest("", Method.${method});`
    ];
    activeHeaders(r).forEach(h => {
      lines.push(`request.AddHeader("${doubleQuoteEscape((h.key || '').trim())}", "${doubleQuoteEscape(h.value || '')}");`);
    });
    if (hasBody(r)) {
      lines.push(`request.AddStringBody(${JSON.stringify(bodyString(r))}, DataFormat.Json);`);
    }
    lines.push(`var response = await client.ExecuteAsync(request);`);
    lines.push(`Console.WriteLine(response.Content);`);
    return lines.join('\n');
  }
};

const php: SnippetGenerator = {
  id: 'php',
  label: 'PHP / Guzzle',
  editorLang: 'php',
  generate(r) {
    const method = methodOf(r);
    const headers = headerMap(r);
    const lines = [
      `<?php`,
      `$client = new \\GuzzleHttp\\Client();`,
      ``,
      `$response = $client->request('${method}', '${r.url.replace(/'/g, "\\'")}', [`,
    ];
    if (Object.keys(headers).length) {
      lines.push(`  'headers' => ${phpArray(headers, 2)},`);
    }
    if (hasBody(r)) {
      lines.push(`  'body' => ${JSON.stringify(bodyString(r))},`);
    }
    lines.push(`]);`);
    lines.push(`echo $response->getBody();`);
    return lines.join('\n');
  }
};

function phpArray(obj: Record<string, string>, indent: number): string {
  const pad = ' '.repeat(indent);
  const entries = Object.entries(obj)
    .map(([k, v]) => `${pad}  '${k.replace(/'/g, "\\'")}' => '${(v || '').replace(/'/g, "\\'")}'`)
    .join(",\n");
  return `[\n${entries}\n${pad}]`;
}

@Injectable({ providedIn: 'root' })
export class SnippetService {
  /** Registry of generators in the order they appear in the UI. */
  private readonly generators: SnippetGenerator[] = [
    curl, httpie, nodeFetch, nodeAxios, python, go, ruby, javaOkhttp, csharp, php
  ];

  /** All registered generators. */
  getGenerators(): SnippetGenerator[] {
    return this.generators;
  }

  /** Find a generator by id. Returns `undefined` if none match. */
  getGenerator(id: string): SnippetGenerator | undefined {
    return this.generators.find(g => g.id === id);
  }

  /** Legacy APIs kept so older callers / specs keep compiling. */
  generateCurl(request: Request): string { return curl.generate(request); }
  generateFetch(request: Request): string { return nodeFetch.generate(request); }
  generatePython(request: Request): string { return python.generate(request); }
}
