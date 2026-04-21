import { Injectable } from '@angular/core';
import { BehaviorSubject, Observable } from 'rxjs';

/**
 * A single runnable command surfaced in the command palette. Commands are
 * lightweight — just a handler + metadata; features register them at startup
 * (or dynamically) via `CommandRegistryService`.
 */
export interface Command {
  id: string;
  label: string;
  /** Optional secondary text (shortcut hint, category, context). */
  hint?: string;
  /** Grouping label shown above a section of commands. */
  category?: string;
  /** Keyword tags searched alongside the label. */
  keywords?: string[];
  /** Optional icon name or SVG path — kept as a free-form string. */
  icon?: string;
  /** Keyboard-shortcut hint to display on the right (doesn't wire the shortcut). */
  shortcut?: string;
  /** Invocation handler. Called on Enter. */
  run: () => void | Promise<void>;
  /** Higher sort-weight means higher rank on ties. Default 0. */
  weight?: number;
}

/**
 * Central registry for palette commands. Services call `register` during
 * their construction or during a lazy "first palette open" hook; the
 * palette component subscribes to `commands$`.
 */
@Injectable({ providedIn: 'root' })
export class CommandRegistryService {
  private readonly commands = new Map<string, Command>();
  private readonly commands$$ = new BehaviorSubject<Command[]>([]);

  /** Observable of all registered commands (latest value on subscribe). */
  readonly commands$: Observable<Command[]> = this.commands$$.asObservable();

  /** Register or replace a command by id. */
  register(cmd: Command): void {
    this.commands.set(cmd.id, cmd);
    this.emit();
  }

  /** Register many commands atomically. */
  registerAll(cmds: Command[]): void {
    cmds.forEach(c => this.commands.set(c.id, c));
    this.emit();
  }

  /** Remove a command by id. No-op if not registered. */
  unregister(id: string): void {
    if (this.commands.delete(id)) this.emit();
  }

  /** Remove every command whose id starts with the given prefix. */
  unregisterPrefix(prefix: string): void {
    let changed = false;
    for (const id of Array.from(this.commands.keys())) {
      if (id.startsWith(prefix)) {
        this.commands.delete(id);
        changed = true;
      }
    }
    if (changed) this.emit();
  }

  /** Snapshot of current commands — sorted by category then label. */
  snapshot(): Command[] {
    return Array.from(this.commands.values()).sort(byCategoryThenLabel);
  }

  private emit() {
    this.commands$$.next(this.snapshot());
  }
}

function byCategoryThenLabel(a: Command, b: Command): number {
  const ca = a.category || '';
  const cb = b.category || '';
  if (ca !== cb) return ca.localeCompare(cb);
  return a.label.localeCompare(b.label);
}

/**
 * Score a single command against a user query using a simple subsequence
 * match. Returns `null` when the query isn't a subsequence, otherwise a
 * numeric score where higher = better. Scoring rules:
 *   +5  for each consecutive character run
 *   +3  for a match at a word boundary / camelCase boundary
 *   +1  for every matched character
 *   -n  for unmatched characters between matches (shorter is better)
 *
 * Matches are case-insensitive. Keywords are considered as part of the
 * haystack when non-empty.
 */
export function fuzzyScore(query: string, command: Command): { score: number; indices: number[] } | null {
  const needle = query.toLowerCase().trim();
  if (!needle) return { score: 1, indices: [] };

  const base = `${command.label}  ${command.keywords?.join(' ') ?? ''}`.toLowerCase();
  const haystack = base;

  let score = 0;
  let run = 0;
  let qi = 0;
  let gap = 0;
  const indices: number[] = [];
  for (let i = 0; i < haystack.length && qi < needle.length; i++) {
    const hc = haystack[i];
    const qc = needle[qi];
    if (hc === qc) {
      indices.push(i);
      const prev = i > 0 ? haystack[i - 1] : ' ';
      const isBoundary = /[\s\-_/.]/.test(prev) || (prev >= 'a' && prev <= 'z' && hc !== prev && /[A-Z]/.test(command.label[i] ?? ''));
      score += 1;
      if (isBoundary) score += 3;
      run += 1;
      if (run > 1) score += 5;
      score -= Math.min(gap, 3);
      gap = 0;
      qi++;
    } else {
      run = 0;
      if (qi > 0) gap++;
    }
  }
  if (qi < needle.length) return null;
  score += (command.weight ?? 0) * 2;
  score += Math.max(0, 40 - command.label.length) / 20;
  return { score, indices };
}

export interface CommandSearchResult {
  command: Command;
  score: number;
  indices: number[];
}

/** Run a query against the registry and return ranked matches. */
export function searchCommands(query: string, all: Command[]): CommandSearchResult[] {
  const scored: CommandSearchResult[] = [];
  for (const cmd of all) {
    const m = fuzzyScore(query, cmd);
    if (m) scored.push({ command: cmd, score: m.score, indices: m.indices });
  }
  scored.sort((a, b) => b.score - a.score);
  return scored;
}
