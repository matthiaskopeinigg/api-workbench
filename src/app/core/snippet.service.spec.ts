import { TestBed } from '@angular/core/testing';
import { SnippetService } from './snippet.service';
import { HttpMethod, Request } from '@models/request';

function makeRequest(overrides: Partial<Request> = {}): Request {
  return {
    id: 'r1',
    title: 'Demo',
    url: 'https://api.example.com/widgets',
    httpMethod: HttpMethod.POST,
    httpHeaders: [
      { key: 'Content-Type', value: 'application/json', enabled: true },
      { key: 'X-Api-Key', value: 'abc', enabled: true },
      { key: 'Disabled', value: 'nope', enabled: false }
    ],
    httpParameters: [],
    requestBody: '{"hello":"world"}',
    script: { preRequest: '', postRequest: '' },
    ...overrides
  } as Request;
}

describe('SnippetService', () => {
  let service: SnippetService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(SnippetService);
  });

  it('exposes all registered generators', () => {
    const ids = service.getGenerators().map(g => g.id);
    expect(ids).toEqual([
      'curl', 'httpie', 'fetch', 'axios', 'python', 'go', 'ruby', 'java-okhttp', 'csharp', 'php'
    ]);
  });

  it('generates cURL with headers, method and body', () => {
    const out = service.generateCurl(makeRequest());
    expect(out).toContain('curl --location --request POST');
    expect(out).toContain('Content-Type: application/json');
    expect(out).toContain("--data-raw '{\"hello\":\"world\"}'");
    expect(out).not.toContain('Disabled');
  });

  it('generates Fetch with method + body', () => {
    const out = service.generateFetch(makeRequest());
    expect(out).toContain('fetch("https://api.example.com/widgets"');
    expect(out).toContain('"method": "POST"');
    expect(out).toContain('"body":');
  });

  it('generates Python requests with headers dict', () => {
    const out = service.generatePython(makeRequest());
    expect(out).toContain('import requests');
    expect(out).toContain('url = "https://api.example.com/widgets"');
    expect(out).toContain('"X-Api-Key": "abc"');
  });

  it('generates Go net/http with strings.NewReader when body present', () => {
    const out = service.getGenerator('go')!.generate(makeRequest());
    expect(out).toContain('package main');
    expect(out).toContain('net/http');
    expect(out).toContain('strings.NewReader');
    expect(out).toContain('req.Header.Add("X-Api-Key"');
  });

  it('generates Go net/http without strings import for GET', () => {
    const out = service.getGenerator('go')!.generate(makeRequest({ httpMethod: HttpMethod.GET, requestBody: '' }));
    expect(out).not.toContain('strings.NewReader');
    expect(out).not.toContain('"strings"');
  });

  it('generates Ruby Net::HTTP with correct verb class', () => {
    const out = service.getGenerator('ruby')!.generate(makeRequest());
    expect(out).toContain("require 'net/http'");
    expect(out).toContain('Net::HTTP::Post.new(url)');
    expect(out).toContain('request.body = "{\\"hello\\":\\"world\\"}"');
  });

  it('generates Java OkHttp with method + body + headers', () => {
    const out = service.getGenerator('java-okhttp')!.generate(makeRequest());
    expect(out).toContain('OkHttpClient client = new OkHttpClient();');
    expect(out).toContain('MediaType.parse("application/json")');
    expect(out).toContain('.method("POST", body)');
    expect(out).toContain('.addHeader("X-Api-Key", "abc")');
  });

  it('generates C# RestSharp with proper Method enum', () => {
    const out = service.getGenerator('csharp')!.generate(makeRequest());
    expect(out).toContain('new RestClient("https://api.example.com/widgets")');
    expect(out).toContain('Method.Post');
    expect(out).toContain('AddStringBody');
  });

  it('generates PHP Guzzle with headers and body arrays', () => {
    const out = service.getGenerator('php')!.generate(makeRequest());
    expect(out).toContain("GuzzleHttp\\Client()");
    expect(out).toContain("$client->request('POST'");
    expect(out).toContain("'headers' =>");
    expect(out).toContain("'body' =>");
  });

  it('omits the body line for GET requests in all generators', () => {
    const req = makeRequest({ httpMethod: HttpMethod.GET, requestBody: '' });
    service.getGenerators().forEach(g => {
      const out = g.generate(req);
      expect(out).not.toMatch(/body:|data=|\\.body =|AddStringBody/);
    });
  });

  it('generates HTTPie snippet', () => {
    const out = service.getGenerator('httpie')!.generate(makeRequest());
    expect(out).toContain('http POST');
    expect(out).toContain("'Content-Type:application/json'");
  });

  it('generates Axios snippet', () => {
    const out = service.getGenerator('axios')!.generate(makeRequest());
    expect(out).toContain('import axios');
    expect(out).toContain('"method": "post"');
  });
});
