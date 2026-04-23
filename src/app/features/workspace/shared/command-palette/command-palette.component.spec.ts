import { ComponentFixture, TestBed } from '@angular/core/testing';
import { CommandRegistryService } from '@core/commands/command-registry.service';
import { CommandPaletteComponent } from './command-palette.component';
import { KeyboardShortcutsService } from '@core/keyboard/keyboard-shortcuts.service';

describe('CommandPaletteComponent', () => {
  let fixture: ComponentFixture<CommandPaletteComponent>;
  let component: CommandPaletteComponent;
  let registry: CommandRegistryService;
  let paletteToggleHandler: (() => boolean | void) | undefined;

  beforeEach(async () => {
    const kbSpy = jasmine.createSpyObj<Pick<KeyboardShortcutsService, 'register'>>('KeyboardShortcutsService', [
      'register',
    ]);
    kbSpy.register.and.callFake((_id: string, fn: () => boolean | void) => {
      paletteToggleHandler = fn;
      return () => {
        paletteToggleHandler = undefined;
      };
    });

    await TestBed.configureTestingModule({
      imports: [CommandPaletteComponent],
      providers: [{ provide: KeyboardShortcutsService, useValue: kbSpy }],
    }).compileComponents();
    fixture = TestBed.createComponent(CommandPaletteComponent);
    component = fixture.componentInstance;
    registry = TestBed.inject(CommandRegistryService);

    registry.registerAll([
      { id: 'one', label: 'Do one thing', run: () => undefined },
      { id: 'two', label: 'Do two things', run: () => undefined },
    ]);

    fixture.detectChanges();
  });

  it('is closed by default', () => {
    expect(component.isOpen).toBeFalse();
  });

  it('open() loads results and marks open', () => {
    component.open();
    expect(component.isOpen).toBeTrue();
    expect(component.results.length).toBeGreaterThanOrEqual(2);
  });

  it('registered palette toggle handler opens and closes the palette', () => {
    expect(paletteToggleHandler).toBeDefined();
    paletteToggleHandler!();
    expect(component.isOpen).toBeTrue();
    paletteToggleHandler!();
    expect(component.isOpen).toBeFalse();
  });

  it('Escape closes an open palette', () => {
    component.open();
    component.onDocumentKeydown(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(component.isOpen).toBeFalse();
  });

  it('ArrowDown cycles the active index', () => {
    component.open();
    const before = component.activeIndex;
    component.onDocumentKeydown(new KeyboardEvent('keydown', { key: 'ArrowDown' }));
    expect(component.activeIndex).not.toBe(before);
  });

  it('runActive invokes the command handler and closes the palette', async () => {
    let fired = false;
    registry.register({ id: 'fire', label: 'Fire the test', run: () => { fired = true; } });
    component.open();
    component.query = 'fire';
    component.onQueryChange();
    await component.runActive();
    expect(fired).toBeTrue();
    expect(component.isOpen).toBeFalse();
  });

  it('filters results by the current query', () => {
    component.open();
    component.query = 'two';
    component.onQueryChange();
    expect(component.results[0]?.command.id).toBe('two');
  });
});
