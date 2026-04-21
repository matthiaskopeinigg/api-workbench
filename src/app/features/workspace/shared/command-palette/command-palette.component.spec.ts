import { ComponentFixture, TestBed } from '@angular/core/testing';
import { CommandRegistryService } from '@core/command-registry.service';
import { CommandPaletteComponent } from './command-palette.component';

describe('CommandPaletteComponent', () => {
  let fixture: ComponentFixture<CommandPaletteComponent>;
  let component: CommandPaletteComponent;
  let registry: CommandRegistryService;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [CommandPaletteComponent],
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

  it('Ctrl+K toggles the palette open and closed', () => {
    const open = new KeyboardEvent('keydown', { key: 'k', ctrlKey: true });
    component.onDocumentKeydown(open);
    expect(component.isOpen).toBeTrue();

    const close = new KeyboardEvent('keydown', { key: 'k', ctrlKey: true });
    component.onDocumentKeydown(close);
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
