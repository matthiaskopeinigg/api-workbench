import { ComponentFixture, TestBed } from '@angular/core/testing';
import { SimpleEditorComponent } from './simple-editor.component';

describe('SimpleEditorComponent', () => {
  let component: SimpleEditorComponent;
  let fixture: ComponentFixture<SimpleEditorComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [SimpleEditorComponent]
    }).compileComponents();

    fixture = TestBed.createComponent(SimpleEditorComponent);
    component = fixture.componentInstance;
    component.language = 'json';
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('should render toolbar only when not readonly and no hideToolbar flag', () => {
    const toolbar = () => fixture.nativeElement.querySelector('.editor-toolbar');
    expect(toolbar()).toBeTruthy();

    component.hideToolbar = true;
    fixture.detectChanges();
    expect(toolbar()).toBeNull();
  });

  it('onContentChange should emit contentChange with the new value', () => {
    const spy = jasmine.createSpy('contentChange');
    component.contentChange.subscribe(spy);

    component.onContentChange('{"a": 1}');

    expect(component.content).toBe('{"a": 1}');
    expect(spy).toHaveBeenCalledWith('{"a": 1}');
  });

  it('formatCode should pretty-print valid JSON', () => {
    component.content = '{"a":1,"b":[1,2]}';
    component.formatCode();
    expect(component.content).toBe('{\n  "a": 1,\n  "b": [\n    1,\n    2\n  ]\n}');
  });

  it('formatCode should silently ignore invalid JSON', () => {
    component.content = 'not-json';
    component.formatCode();
    expect(component.content).toBe('not-json');
  });

  it('formatCode should be a no-op when readonly', () => {
    component.readonly = true;
    component.content = '{"a":1}';
    component.formatCode();
    expect(component.content).toBe('{"a":1}');
  });

  it('updateHighlighting should produce an empty state on empty content', () => {
    component.content = '';
    component.updateHighlighting();
    expect(component.highlightedContent).toBe('');
    expect(component.lines).toEqual([1]);
  });

  it('updateHighlighting should wrap JSON string values with token-string span', () => {
    component.language = 'json';
    component.content = '{"name": "alice"}';
    component.updateHighlighting();
    expect(component.highlightedContent).toContain('token-string');
    expect(component.highlightedContent).toContain('token-key');
  });

  it('updateHighlighting should render variable placeholders with a highlight class', () => {
    component.language = 'plain';
    component.activeVariables = { host: 'example.org' };
    component.content = '{{host}}/path';
    component.updateHighlighting();
    expect(component.highlightedContent).toContain('variable-highlight');
    expect(component.highlightedContent).toContain('example.org');
  });

  it('copyToClipboard should call navigator.clipboard.writeText with content', () => {
    const writeTextSpy = jasmine.createSpy('writeText').and.returnValue(Promise.resolve());
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: writeTextSpy }
    });
    component.content = 'hello';
    component.copyToClipboard();
    expect(writeTextSpy).toHaveBeenCalledWith('hello');
  });
});
