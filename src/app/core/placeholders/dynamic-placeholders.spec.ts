import {
  applyDynamicPlaceholders,
  getDynamicPlaceholderCompletions,
  isKnownDynamicName,
} from './dynamic-placeholders';

describe('applyDynamicPlaceholders', () => {
  it('replaces bare $uuid and produces UUID-like value', () => {
    const s = 'param-test-$uuid&x=$uuid';
    const out = applyDynamicPlaceholders(s);
    expect(out).not.toContain('$uuid');
    const uuids = out.match(
      /[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/gi,
    );
    expect(uuids?.length).toBe(2);
  });

  it('does not change unknown $tokens', () => {
    expect(applyDynamicPlaceholders('a-$notARealToken')).toBe('a-$notARealToken');
  });

  it('replaces {{$uuid}} and bare order: env would run before in real pipeline', () => {
    const out = applyDynamicPlaceholders('{{$uuid}}');
    expect(out).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
  });

  it('replaces $randomInt(n) and $randomLong(n) with n digits', () => {
    const a = applyDynamicPlaceholders('x-$randomInt(1)-y');
    expect(a).toMatch(/^x-[0-9]-y$/);
    const b = applyDynamicPlaceholders('$randomLong(4)');
    expect(b).toMatch(/^[0-9]{4}$/);
  });

  it('rejects invalid lengths in parentheses', () => {
    expect(applyDynamicPlaceholders('$randomInt(0)')).toBe('$randomInt(0)');
    expect(applyDynamicPlaceholders('$randomInt(21)')).toBe('$randomInt(21)');
  });
});

describe('isKnownDynamicName', () => {
  it('recognizes built-in names', () => {
    expect(isKnownDynamicName('uuid')).toBeTrue();
    expect(isKnownDynamicName('isoTimestamp')).toBeTrue();
    expect(isKnownDynamicName('nope')).toBeFalse();
  });
});

describe('getDynamicPlaceholderCompletions', () => {
  it('returns all with empty prefix', () => {
    expect(getDynamicPlaceholderCompletions('').map((o) => o.name).length).toBeGreaterThan(3);
  });
  it('filters by prefix', () => {
    const u = getDynamicPlaceholderCompletions('u');
    expect(u.some((o) => o.name === 'uuid')).toBeTrue();
    expect(u.every((o) => o.name.toLowerCase().startsWith('u'))).toBeTrue();
  });

  it('includes length examples when prefix matches', () => {
    const r = getDynamicPlaceholderCompletions('r');
    expect(r.some((o) => o.label === '$randomInt(6)')).toBeTrue();
  });
});
