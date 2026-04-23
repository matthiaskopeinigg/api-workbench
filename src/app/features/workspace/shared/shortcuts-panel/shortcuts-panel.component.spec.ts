import { ComponentFixture, TestBed } from '@angular/core/testing';
import { BehaviorSubject } from 'rxjs';
import { ShortcutsPanelComponent } from './shortcuts-panel.component';
import { APP_SHORTCUTS, ShortcutsPanelService } from '@core/commands/shortcuts-panel.service';

describe('ShortcutsPanelComponent', () => {
  let fixture: ComponentFixture<ShortcutsPanelComponent>;
  let component: ShortcutsPanelComponent;
  let panelOpen$: BehaviorSubject<boolean>;
  let panelSpy: jasmine.SpyObj<ShortcutsPanelService>;

  beforeEach(async () => {
    panelOpen$ = new BehaviorSubject<boolean>(false);
    panelSpy = jasmine.createSpyObj('ShortcutsPanelService', ['isOpen', 'toggle', 'close']);
    panelSpy.isOpen.and.returnValue(panelOpen$.asObservable());

    await TestBed.configureTestingModule({
      imports: [ShortcutsPanelComponent],
      providers: [{ provide: ShortcutsPanelService, useValue: panelSpy }],
    }).compileComponents();

    fixture = TestBed.createComponent(ShortcutsPanelComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('groups APP_SHORTCUTS by category on init', () => {
    expect(component.groups.length).toBeGreaterThan(0);
    const flattened = component.groups.flatMap((g) => g.entries);
    expect(flattened.length).toBe(APP_SHORTCUTS.length);
    const cats = component.groups.map((g) => g.category);
    expect(new Set(cats).size).toBe(cats.length);
  });

  it('syncs the isOpen flag with the service observable', () => {
    expect(component.isOpen).toBeFalse();
    panelOpen$.next(true);
    fixture.detectChanges();
    expect(component.isOpen).toBeTrue();
  });

  it('Ctrl+/ toggles the panel via the service', () => {
    const event = new KeyboardEvent('keydown', { key: '/', ctrlKey: true, cancelable: true });
    component.onKeydown(event);
    expect(panelSpy.toggle).toHaveBeenCalled();
    expect(event.defaultPrevented).toBeTrue();
  });

  it('Cmd+/ also toggles (macOS variant)', () => {
    const event = new KeyboardEvent('keydown', { key: '/', metaKey: true, cancelable: true });
    component.onKeydown(event);
    expect(panelSpy.toggle).toHaveBeenCalled();
  });

  it('Escape closes only when the panel is open', () => {
    component.isOpen = false;
    component.onKeydown(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(panelSpy.close).not.toHaveBeenCalled();

    component.isOpen = true;
    component.onKeydown(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(panelSpy.close).toHaveBeenCalled();
  });

  it('ignores other keys entirely', () => {
    component.isOpen = true;
    component.onKeydown(new KeyboardEvent('keydown', { key: 'a' }));
    expect(panelSpy.toggle).not.toHaveBeenCalled();
    expect(panelSpy.close).not.toHaveBeenCalled();
  });

  it('close() proxies to the service', () => {
    component.close();
    expect(panelSpy.close).toHaveBeenCalled();
  });

  it('unsubscribes on destroy', () => {
    const before = panelOpen$.observed;
    fixture.destroy();
    expect(panelOpen$.observed && before).toBeFalse();
  });
});
