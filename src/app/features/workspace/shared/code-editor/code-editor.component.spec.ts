import { ComponentFixture, TestBed } from '@angular/core/testing';
import { CodeEditorComponent } from './code-editor.component';

describe('CodeEditorComponent', () => {
  let component: CodeEditorComponent;
  let fixture: ComponentFixture<CodeEditorComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [CodeEditorComponent]
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

});
