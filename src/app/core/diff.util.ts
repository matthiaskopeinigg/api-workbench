/**
 * Line-based diff using a classic LCS DP. Returns a flat operation list that
 * the side-by-side view can render.
 *
 * The algorithm is intentionally simple (O(n*m) memory) so it remains easy to
 * debug. Callers truncate extreme payloads before invoking.
 */
export type DiffOp =
  | { kind: 'equal'; left: number; right: number; text: string }
  | { kind: 'remove'; left: number; text: string }
  | { kind: 'add'; right: number; text: string };

export interface SideBySideRow {
  left?: { lineNo: number; text: string; kind: 'equal' | 'remove' };
  right?: { lineNo: number; text: string; kind: 'equal' | 'add' };
}

export function diffLines(a: string, b: string): DiffOp[] {
  const aLines = a.length === 0 ? [] : a.split(/\r?\n/);
  const bLines = b.length === 0 ? [] : b.split(/\r?\n/);
  const n = aLines.length;
  const m = bLines.length;
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      if (aLines[i] === bLines[j]) {
        dp[i][j] = dp[i + 1][j + 1] + 1;
      } else {
        dp[i][j] = Math.max(dp[i + 1][j], dp[i][j + 1]);
      }
    }
  }
  const ops: DiffOp[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (aLines[i] === bLines[j]) {
      ops.push({ kind: 'equal', left: i + 1, right: j + 1, text: aLines[i] });
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      ops.push({ kind: 'remove', left: i + 1, text: aLines[i] });
      i++;
    } else {
      ops.push({ kind: 'add', right: j + 1, text: bLines[j] });
      j++;
    }
  }
  while (i < n) ops.push({ kind: 'remove', left: i + 1, text: aLines[i++] });
  while (j < m) ops.push({ kind: 'add', right: j + 1, text: bLines[j++] });
  return ops;
}

export function toSideBySide(ops: DiffOp[]): SideBySideRow[] {
  const rows: SideBySideRow[] = [];
  let pendingRemoves: Array<{ left: number; text: string }> = [];
  let pendingAdds: Array<{ right: number; text: string }> = [];
  const flushPending = () => {
    const len = Math.max(pendingRemoves.length, pendingAdds.length);
    for (let k = 0; k < len; k++) {
      const row: SideBySideRow = {};
      if (pendingRemoves[k]) {
        row.left = { lineNo: pendingRemoves[k].left, text: pendingRemoves[k].text, kind: 'remove' };
      }
      if (pendingAdds[k]) {
        row.right = { lineNo: pendingAdds[k].right, text: pendingAdds[k].text, kind: 'add' };
      }
      rows.push(row);
    }
    pendingRemoves = [];
    pendingAdds = [];
  };
  for (const op of ops) {
    if (op.kind === 'equal') {
      flushPending();
      rows.push({
        left: { lineNo: op.left, text: op.text, kind: 'equal' },
        right: { lineNo: op.right, text: op.text, kind: 'equal' }
      });
    } else if (op.kind === 'remove') {
      pendingRemoves.push({ left: op.left, text: op.text });
    } else {
      pendingAdds.push({ right: op.right, text: op.text });
    }
  }
  flushPending();
  return rows;
}

/** Best-effort JSON canonicalization so key-order noise doesn't inflate the diff. */
export function canonicalizeIfJson(body: string | null | undefined, contentType?: string | null): string {
  const text = body ?? '';
  const ct = (contentType || '').toLowerCase();
  const looksJson = ct.includes('json') || text.trim().startsWith('{') || text.trim().startsWith('[');
  if (!looksJson) return text;
  try {
    const parsed = JSON.parse(text);
    return JSON.stringify(parsed, sortedReplacer, 2);
  } catch {
    return text;
  }
}

function sortedReplacer(_key: string, value: unknown): unknown {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const sorted: Record<string, unknown> = {};
    for (const k of Object.keys(value as Record<string, unknown>).sort()) {
      sorted[k] = (value as Record<string, unknown>)[k];
    }
    return sorted;
  }
  return value;
}
