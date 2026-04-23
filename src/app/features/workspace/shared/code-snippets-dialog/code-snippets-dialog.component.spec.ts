import { ComponentFixture, TestBed } from '@angular/core/testing';

import { CodeSnippetsDialogComponent } from './code-snippets-dialog.component';
import { SnippetService, SnippetGenerator } from '@core/snippets/snippet.service';
import { HttpMethod } from '@models/request';

describe('CodeSnippetsDialogComponent', () => {
  let component: CodeSnippetsDialogComponent;
  let fixture: ComponentFixture<CodeSnippetsDialogComponent>;

  const curlGen: SnippetGenerator = {
    id: 'curl', label: 'cURL', editorLang: 'plain',
    generate: () => 'curl https://example.com',
  };
  const fetchGen: SnippetGenerator = {
    id: 'fetch', label: 'Fetch (Node)', editorLang: 'javascript',
    generate: () => 'fetch(...)',
  };
  const pythonGen: SnippetGenerator = {
    id: 'python', label: 'Python', editorLang: 'python',
    generate: () => 'import requests',
  };

  beforeEach(async () => {
    const snippetServiceSpy = jasmine.createSpyObj('SnippetService', [
      'getGenerators',
      'getGenerator',
      'generateCurl',
      'generateFetch',
      'generatePython',
    ]);
    snippetServiceSpy.getGenerators.and.returnValue([curlGen, fetchGen, pythonGen]);
    snippetServiceSpy.getGenerator.and.callFake((id: string) =>
      [curlGen, fetchGen, pythonGen].find(g => g.id === id)
    );

    await TestBed.configureTestingModule({
      imports: [CodeSnippetsDialogComponent],
      providers: [{ provide: SnippetService, useValue: snippetServiceSpy }],
    }).compileComponents();

    fixture = TestBed.createComponent(CodeSnippetsDialogComponent);
    component = fixture.componentInstance;
    component.request = {
      id: 'r1',
      title: 'Test',
      httpMethod: HttpMethod.GET,
      url: 'https://example.com',
    } as any;
    fixture.detectChanges();
    await fixture.whenStable();
  });

  it('should create and pre-render the default curl snippet', () => {
    expect(component).toBeTruthy();
    expect(component.selectedId).toBe('curl');
    expect(component.editorLang).toBe('plain');
    expect(component.snippetText).toBe('curl https://example.com');
  });

  it('setLang should switch the snippet and editor language', () => {
    component.setLang('fetch');
    expect(component.selectedId).toBe('fetch');
    expect(component.editorLang).toBe('javascript');
    expect(component.snippetText).toBe('fetch(...)');

    component.setLang('python');
    expect(component.selectedId).toBe('python');
    expect(component.editorLang).toBe('python');
    expect(component.snippetText).toBe('import requests');
  });

  it('copySnippet should forward the rendered snippet to navigator.clipboard', () => {
    const writeTextSpy = jasmine.createSpy('writeText').and.returnValue(Promise.resolve());
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: writeTextSpy }
    });

    component.snippetText = 'snippet-body';
    component.copySnippet();

    expect(writeTextSpy).toHaveBeenCalledWith('snippet-body');
  });

  it('close EventEmitter should fire when emitted externally', () => {
    const spy = jasmine.createSpy('close');
    component.close.subscribe(spy);
    component.close.emit();
    expect(spy).toHaveBeenCalled();
  });
});
