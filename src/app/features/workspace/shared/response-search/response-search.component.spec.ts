import { compileQuery, computeMatches, buildSegments } from './response-search.component';

describe('response-search helpers', () => {
  describe('compileQuery', () => {
    it('returns null for empty query', () => {
      expect(compileQuery('', { caseSensitive: false, regex: false })).toBeNull();
    });
    it('escapes regex meta when regex mode is off', () => {
      const re = compileQuery('a.b', { caseSensitive: false, regex: false })!;
      expect(re.test('aXb')).toBeFalse();
      expect(re.test('a.b')).toBeTrue();
    });
    it('respects the regex toggle', () => {
      const re = compileQuery('a.b', { caseSensitive: false, regex: true })!;
      expect(re.test('aXb')).toBeTrue();
    });
    it('respects case sensitivity', () => {
      const reI = compileQuery('abc', { caseSensitive: false, regex: false })!;
      const reS = compileQuery('abc', { caseSensitive: true, regex: false })!;
      expect(reI.test('ABC')).toBeTrue();
      expect(reS.test('ABC')).toBeFalse();
    });
    it('returns null for invalid regex', () => {
      expect(compileQuery('[unclosed', { caseSensitive: false, regex: true })).toBeNull();
    });
  });

  describe('computeMatches', () => {
    it('finds every occurrence', () => {
      const m = computeMatches('banana', 'an', { caseSensitive: false, regex: false });
      expect(m).toEqual([{ start: 1, end: 3 }, { start: 3, end: 5 }]);
    });
    it('handles case-insensitive matches', () => {
      const m = computeMatches('Foo foo FOO', 'foo', { caseSensitive: false, regex: false });
      expect(m.length).toBe(3);
    });
    it('returns [] for empty text or query', () => {
      expect(computeMatches('', 'x', { caseSensitive: false, regex: false })).toEqual([]);
      expect(computeMatches('x', '', { caseSensitive: false, regex: false })).toEqual([]);
    });
    it('skips zero-length regex matches', () => {
      const m = computeMatches('abc', '.*', { caseSensitive: false, regex: true });
      expect(m.length).toBe(1);
      expect(m[0]).toEqual({ start: 0, end: 3 });
    });
  });

  describe('buildSegments', () => {
    it('returns a single plain segment when no matches', () => {
      expect(buildSegments('hello', [])).toEqual([{ text: 'hello', matchIndex: null }]);
    });
    it('alternates plain and match segments', () => {
      const segs = buildSegments('abcXabcXabc', [{ start: 3, end: 4 }, { start: 7, end: 8 }]);
      expect(segs).toEqual([
        { text: 'abc', matchIndex: null },
        { text: 'X', matchIndex: 0 },
        { text: 'abc', matchIndex: null },
        { text: 'X', matchIndex: 1 },
        { text: 'abc', matchIndex: null }
      ]);
    });
    it('starts with a match segment when match is at index 0', () => {
      const segs = buildSegments('XXab', [{ start: 0, end: 2 }]);
      expect(segs).toEqual([
        { text: 'XX', matchIndex: 0 },
        { text: 'ab', matchIndex: null }
      ]);
    });
  });
});
