import { TestBed } from '@angular/core/testing';
import { ImportService, tokenizeCurl, buildBodyFromCurlParts } from './import.service';
import { HttpMethod } from '@models/request';

describe('ImportService — cURL import', () => {
  let service: ImportService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(ImportService);
  });

  describe('tokenizeCurl', () => {
    it('splits on whitespace', () => {
      expect(tokenizeCurl('curl https://x.test')).toEqual(['curl', 'https://x.test']);
    });

    it('preserves single-quoted strings', () => {
      const out = tokenizeCurl("curl 'https://x.test' -H 'X-A: 1'");
      expect(out).toEqual(['curl', 'https://x.test', '-H', 'X-A: 1']);
    });

    it('supports line continuations with backslash', () => {
      const out = tokenizeCurl("curl 'https://x.test' \\\n  -H 'A: B'");
      expect(out).toEqual(['curl', 'https://x.test', '-H', 'A: B']);
    });

    it('handles double-quoted values with escapes', () => {
      const out = tokenizeCurl('curl "https://x.test" -d "{\\"a\\":1}"');
      expect(out).toEqual(['curl', 'https://x.test', '-d', '{"a":1}']);
    });
  });

  describe('buildBodyFromCurlParts', () => {
    it('returns undefined for no parts', () => {
      expect(buildBodyFromCurlParts([], [], [], [])).toBeUndefined();
    });
    it('detects JSON bodies', () => {
      const b = buildBodyFromCurlParts([], ['{"a":1}'], [], []);
      expect(b?.mode).toBe('json');
      expect(b?.raw).toBe('{"a":1}');
    });
    it('builds urlencoded when --data-urlencode present', () => {
      const b = buildBodyFromCurlParts([], [], [{ key: 'a', value: '1' }], []);
      expect(b?.mode).toBe('urlencoded');
      expect(b?.urlencoded?.[0]).toEqual(jasmine.objectContaining({ key: 'a', value: '1' }));
    });
    it('builds form-data when form parts present', () => {
      const b = buildBodyFromCurlParts([], [], [], [{ key: 'x', type: 'text', value: '1', enabled: true }]);
      expect(b?.mode).toBe('form-data');
    });
  });

  describe('importCurl', () => {
    it('parses a simple GET', () => {
      const req = service.importCurl('curl https://api.example.com/list');
      expect(req.url).toBe('https://api.example.com/list');
      expect(req.httpMethod).toBe(HttpMethod.GET);
      expect(req.httpHeaders?.length ?? 0).toBe(0);
    });

    it('parses method + headers + json body', () => {
      const curl = `curl -X POST 'https://api.example.com/things' \\\n -H 'Content-Type: application/json' \\\n -H 'Authorization: Bearer abc' \\\n -d '{"name":"box"}'`;
      const req = service.importCurl(curl);
      expect(req.httpMethod).toBe(HttpMethod.POST);
      expect(req.url).toBe('https://api.example.com/things');
      expect(req.httpHeaders?.length).toBe(2);
      expect(req.body?.mode).toBe('json');
      expect(req.body?.raw).toBe('{"name":"box"}');
    });

    it('defaults to POST when body is present and method is unspecified', () => {
      const req = service.importCurl(`curl 'https://api.example.com' -d 'a=1'`);
      expect(req.httpMethod).toBe(HttpMethod.POST);
    });

    it('parses --data-urlencode as urlencoded body', () => {
      const req = service.importCurl(`curl -X POST 'https://api.example.com' --data-urlencode 'a=1' --data-urlencode 'b=two'`);
      expect(req.body?.mode).toBe('urlencoded');
      expect(req.body?.urlencoded?.length).toBe(2);
    });

    it('parses -F as form-data with file attachments', () => {
      const req = service.importCurl(`curl -X POST 'https://api.example.com' -F 'name=box' -F 'file=@/tmp/thing.png'`);
      expect(req.body?.mode).toBe('form-data');
      expect(req.body?.form?.[0]).toEqual(jasmine.objectContaining({ key: 'name', type: 'text', value: 'box' }));
      expect(req.body?.form?.[1]).toEqual(jasmine.objectContaining({ key: 'file', type: 'file', filePath: '/tmp/thing.png' }));
    });

    it('parses -u as a Basic Authorization header', () => {
      const req = service.importCurl(`curl 'https://x.test' -u 'alice:s3cret'`);
      const auth = req.httpHeaders?.find(h => (h.key || '').toLowerCase() === 'authorization');
      expect(auth?.value).toBe('Basic ' + btoa('alice:s3cret'));
    });

    it('ignores --compressed and --location flags', () => {
      const req = service.importCurl(`curl --location --compressed 'https://x.test'`);
      expect(req.url).toBe('https://x.test');
    });
  });
});
