import { ComponentFixture, TestBed, fakeAsync, flushMicrotasks } from '@angular/core/testing';
import { KeyboardShortcutsService } from '@core/keyboard/keyboard-shortcuts.service';
import { CodeEditorComponent } from './code-editor.component';

describe('CodeEditorComponent', () => {
  let component: CodeEditorComponent;
  let fixture: ComponentFixture<CodeEditorComponent>;

  beforeEach(async () => {
    const keyboardStub = jasmine.createSpyObj<KeyboardShortcutsService>('KeyboardShortcutsService', [
      'matchesEditorAction',
      'effectiveChord',
    ]);
    keyboardStub.matchesEditorAction.and.returnValue(false);

    await TestBed.configureTestingModule({
      imports: [CodeEditorComponent],
      providers: [{ provide: KeyboardShortcutsService, useValue: keyboardStub }],
    }).compileComponents();

    fixture = TestBed.createComponent(CodeEditorComponent);
    component = fixture.componentInstance;
    component.language = 'json';
    fixture.detectChanges();
  });

  it('should create and initialise innerContent from input', () => {
    component.content = '{"a":1}';
    component.ngOnChanges();
    expect(component.innerContent).toBe('{"a":1}');
  });

  it('onContentChange should emit contentChange synchronously', () => {
    const spy = jasmine.createSpy('contentChange');
    component.contentChange.subscribe(spy);

    component.onContentChange('{"x":1}');

    expect(component.innerContent).toBe('{"x":1}');
    expect(spy).toHaveBeenCalledWith('{"x":1}');
  });

  it('formatCode should pretty-print JSON and emit the formatted value', () => {
    const spy = jasmine.createSpy('contentChange');
    component.contentChange.subscribe(spy);
    component.innerContent = '{"a":1,"b":2}';

    component.formatCode();

    expect(component.innerContent).toBe('{\n  "a": 1,\n  "b": 2\n}');
    expect(spy).toHaveBeenCalledWith('{\n  "a": 1,\n  "b": 2\n}');
  });

  it('formatCode should leave invalid JSON untouched', () => {
    component.innerContent = '{broken';
    component.formatCode();
    expect(component.innerContent).toBe('{broken');
  });

  it('formatCode should be a no-op when readonly', () => {
    component.readonly = true;
    component.innerContent = '{"a":1}';
    component.formatCode();
    expect(component.innerContent).toBe('{"a":1}');
  });

  it('formatCode should normalise well-formed XML', () => {
    component.language = 'xml';
    component.innerContent = '<root><child>hi</child></root>';
    component.formatCode();
    expect(component.innerContent).toContain('\n');
    const parsed = new DOMParser().parseFromString(component.innerContent, 'application/xml');
    expect(parsed.querySelector('parsererror')).toBeNull();
    expect(parsed.querySelector('child')?.textContent).toBe('hi');
  });

  it('formatCode should leave malformed XML alone', () => {
    component.language = 'xml';
    component.innerContent = '<unclosed>';
    component.formatCode();
    expect(component.innerContent).toBe('<unclosed>');
  });

  it('updateHighlighting should produce highlighted markup for JSON content', () => {
    component.innerContent = '{"key":123}';
    component.updateHighlighting();
    expect(component.highlightedContent).toContain('token-key');
    expect(component.highlightedContent).toContain('token-number');
  });

  it('updateHighlighting should produce js token markup for javascript', () => {
    component.language = 'javascript';
    component.innerContent = 'const x = 1;';
    component.updateHighlighting();
    expect(component.highlightedContent).toContain('data-tok="k"');
    expect(component.highlightedContent).toContain('data-tok="n"');
  });

  it('updateHighlighting should not corrupt empty string pairs with keyword spans', () => {
    component.language = 'javascript';
    component.innerContent = 'pm.session.set("", "");';
    component.updateHighlighting();
    expect(component.highlightedContent).toContain('data-tok="s"');
    expect(component.highlightedContent).not.toContain('data-tok="k">class');
    expect(component.highlightedContent).not.toMatch(/<span data-tok="k">class<\/span>/);
  });

  it('updateHighlighting should wrap $uuid in variable-highlight in JSON', () => {
    component.innerContent = '"trace-$uuid"';
    component.language = 'json';
    component.updateHighlighting();
    expect(component.highlightedContent).toContain('variable-highlight');
    expect(component.highlightedContent).toContain('$uuid');
  });

  it('should leave non-JSON/XML languages unchanged by auto-format scheduling', () => {
    component.language = 'plain';
    const spy = jasmine.createSpy('contentChange');
    component.contentChange.subscribe(spy);
    component.onContentChange('free text');
    expect(spy).toHaveBeenCalledWith('free text');
  });

  it('onContentChange should strip pasted highlighter span markup in JavaScript', () => {
    component.language = 'javascript';
    const spy = jasmine.createSpy('contentChange');
    component.contentChange.subscribe(spy);
    const dirty = 'pm.session.set(<span class="token-string">\'a\'</span>, 1);';
    component.onContentChange(dirty);
    expect(spy).toHaveBeenCalledWith("pm.session.set('a', 1);");
    expect(component.innerContent).toBe("pm.session.set('a', 1);");
  });

  it('onContentChange should strip mangled fragments without literal <span', () => {
    component.language = 'javascript';
    const spy = jasmine.createSpy('contentChange');
    component.contentChange.subscribe(spy);
    const dirty = 'x);n-string">"", class="token-string">"")y';
    component.onContentChange(dirty);
    expect(component.innerContent).not.toMatch(/token-string|class="/);
    expect(spy).toHaveBeenCalled();
    expect(component.innerContent).toContain('x');
    expect(component.innerContent).toContain('y');
  });

  it('ngOnInit should strip class="token-…"> leak from saved javascript and emit', fakeAsync(() => {
    component.language = 'javascript';
    component.content = 'pm.session.set(class="token-string">"");';
    const spy = jasmine.createSpy('contentChange');
    component.contentChange.subscribe(spy);
    component.ngOnInit();
    flushMicrotasks();
    expect(component.innerContent).toBe('pm.session.set("");');
    expect(spy).toHaveBeenCalledWith('pm.session.set("");');
  }));

  it('ngOnChanges should strip leak when parent content matches corrupted innerContent', fakeAsync(() => {
    component.language = 'javascript';
    const dirty = 'pm.session.set(class="token-string">"")';
    component.content = dirty;
    component.innerContent = dirty;
    const spy = jasmine.createSpy('contentChange');
    component.contentChange.subscribe(spy);
    component.ngOnChanges();
    flushMicrotasks();
    expect(component.innerContent).toBe('pm.session.set("")');
    expect(spy).toHaveBeenCalledWith('pm.session.set("")');
  }));

  it('ngOnChanges should strip JS leak while textarea is focused', fakeAsync(() => {
    component.language = 'javascript';
    const dirty = 'pm.session.set(class="token-string">"");';
    component.content = dirty;
    fixture.detectChanges();
    const ta = fixture.nativeElement.querySelector('textarea') as HTMLTextAreaElement;
    ta.focus();
    expect(document.activeElement).toBe(ta);
    component.innerContent = dirty;
    const spy = jasmine.createSpy('contentChange');
    component.contentChange.subscribe(spy);
    component.ngOnChanges();
    flushMicrotasks();
    expect(component.innerContent).toBe('pm.session.set("");');
    expect(spy).toHaveBeenCalledWith('pm.session.set("");');
  }));

  it('updateHighlighting should strip JS leak in innerContent and emit', fakeAsync(() => {
    component.language = 'javascript';
    component.innerContent = 'x(class="token-string">)y';
    const spy = jasmine.createSpy('contentChange');
    component.contentChange.subscribe(spy);
    component.updateHighlighting();
    flushMicrotasks();
    expect(component.innerContent).not.toMatch(/class="token-/);
    expect(spy).toHaveBeenCalled();
  }));

  it('javascript should not auto-close quote after ;)]}, (caret after delimiter)', () => {
    component.language = 'javascript';
    const v = 'foo();';
    const should = (component as unknown as { shouldAutoCloseQuote: (a: string, b: number, c: number, d: string) => boolean })
      .shouldAutoCloseQuote;
    expect(should.call(component, '"', 6, 6, v)).toBe(false);
  });

  it('javascript should auto-close double-quote after (', () => {
    component.language = 'javascript';
    component.content = 'foo(';
    component.innerContent = 'foo(';
    fixture.detectChanges();
    const ta = fixture.nativeElement.querySelector('textarea') as HTMLTextAreaElement;
    ta.setSelectionRange(4, 4);
    const ev = new KeyboardEvent('keydown', { key: '"', bubbles: true, cancelable: true });
    const pd = spyOn(ev, 'preventDefault');
    component.handleKeydown(ev);
    expect(pd).toHaveBeenCalled();
  });

  it('applyCompletion should not append when identifier prefix is empty after statement', () => {
    component.language = 'javascript';
    component.scriptAutocomplete = true;
    component.innerContent = 'foo();';
    const end = 'foo();'.length;
    const fakeTa = {
      selectionStart: end,
      selectionEnd: end,
      focus: () => {},
      setSelectionRange: jasmine.createSpy('setSelectionRange'),
    } as unknown as HTMLTextAreaElement;
    component.applyCompletion({ label: 'z', insert: 'BAR()' }, fakeTa);
    expect(component.innerContent).toBe('foo();');
  });
});
