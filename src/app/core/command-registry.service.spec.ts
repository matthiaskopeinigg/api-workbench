import { TestBed } from '@angular/core/testing';
import {
  Command,
  CommandRegistryService,
  fuzzyScore,
  searchCommands,
} from './command-registry.service';

function makeCommand(partial: Partial<Command> & { id: string; label: string }): Command {
  return { run: () => undefined, ...partial };
}

describe('CommandRegistryService', () => {
  let service: CommandRegistryService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(CommandRegistryService);
  });

  it('register adds a command and emits the new snapshot', (done) => {
    const cmd = makeCommand({ id: 'test.one', label: 'One' });
    const received: Command[][] = [];
    const sub = service.commands$.subscribe(list => received.push(list));

    service.register(cmd);

    expect(received.length).toBeGreaterThanOrEqual(2);
    expect(received[received.length - 1].map(c => c.id)).toContain('test.one');
    sub.unsubscribe();
    done();
  });

  it('registerAll replaces existing commands by id', () => {
    service.register(makeCommand({ id: 'a', label: 'Alpha' }));
    service.registerAll([
      makeCommand({ id: 'a', label: 'Alpha v2' }),
      makeCommand({ id: 'b', label: 'Beta' }),
    ]);

    const snapshot = service.snapshot();
    expect(snapshot.find(c => c.id === 'a')?.label).toBe('Alpha v2');
    expect(snapshot.map(c => c.id).sort()).toEqual(['a', 'b']);
  });

  it('unregister removes the command', () => {
    service.registerAll([
      makeCommand({ id: 'keep', label: 'Keep' }),
      makeCommand({ id: 'drop', label: 'Drop' }),
    ]);
    service.unregister('drop');
    expect(service.snapshot().map(c => c.id)).toEqual(['keep']);
  });

  it('unregisterPrefix removes matching commands', () => {
    service.registerAll([
      makeCommand({ id: 'tab.close', label: 'Close Tab' }),
      makeCommand({ id: 'tab.new', label: 'New Tab' }),
      makeCommand({ id: 'theme.toggle', label: 'Toggle Theme' }),
    ]);
    service.unregisterPrefix('tab.');
    expect(service.snapshot().map(c => c.id)).toEqual(['theme.toggle']);
  });

  it('snapshot sorts by category then label', () => {
    service.registerAll([
      makeCommand({ id: 'c2', label: 'Bravo', category: 'Data' }),
      makeCommand({ id: 'c1', label: 'Alpha', category: 'Data' }),
      makeCommand({ id: 'c3', label: 'Charlie', category: 'Appearance' }),
    ]);
    expect(service.snapshot().map(c => c.id)).toEqual(['c3', 'c1', 'c2']);
  });
});

describe('fuzzyScore', () => {
  it('returns null when query is not a subsequence', () => {
    const cmd = { id: 'x', label: 'Toggle theme', run: () => undefined };
    expect(fuzzyScore('zzz', cmd)).toBeNull();
  });

  it('matches case-insensitively', () => {
    const cmd = { id: 'x', label: 'Toggle Theme', run: () => undefined };
    expect(fuzzyScore('tt', cmd)).not.toBeNull();
  });

  it('scores consecutive matches higher than scattered ones', () => {
    const cmdA = { id: 'a', label: 'Theme Dracula', run: () => undefined };
    const cmdB = { id: 'b', label: 'Terminate handler', run: () => undefined };
    const a = fuzzyScore('the', cmdA)!;
    const b = fuzzyScore('the', cmdB)!;
    expect(a).not.toBeNull();
    expect(b).not.toBeNull();
    expect(a.score).toBeGreaterThan(b.score);
  });

  it('includes keywords in the haystack', () => {
    const cmd = {
      id: 'x',
      label: 'New Collection',
      keywords: ['import', 'postman'],
      run: () => undefined,
    };
    expect(fuzzyScore('postman', cmd)).not.toBeNull();
  });

  it('returns an empty indices array for an empty query', () => {
    const cmd = { id: 'x', label: 'Anything', run: () => undefined };
    const r = fuzzyScore('', cmd);
    expect(r).not.toBeNull();
    expect(r!.indices).toEqual([]);
  });
});

describe('searchCommands', () => {
  const commands: Command[] = [
    { id: 'theme.toggle', label: 'Toggle theme', run: () => undefined },
    { id: 'theme.dracula', label: 'Theme: Dracula', run: () => undefined },
    { id: 'collection.new', label: 'New collection', run: () => undefined },
    { id: 'cookies.clear', label: 'Clear all cookies', run: () => undefined },
  ];

  it('returns only subsequence matches', () => {
    const results = searchCommands('theme', commands).map(r => r.command.id);
    expect(results).toContain('theme.toggle');
    expect(results).toContain('theme.dracula');
    expect(results).not.toContain('cookies.clear');
  });

  it('ranks closer matches first', () => {
    const results = searchCommands('new', commands);
    expect(results[0].command.id).toBe('collection.new');
  });

  it('returns all commands for empty query', () => {
    const results = searchCommands('', commands);
    expect(results.length).toBe(commands.length);
  });
});
