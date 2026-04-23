import { Component, Input, Output, EventEmitter, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Request } from '@models/request';
import { SnippetService, SnippetGenerator, SnippetEditorLang } from '@core/snippets/snippet.service';
import { CodeEditorComponent } from '../code-editor/code-editor.component';

@Component({
  selector: 'app-code-snippets-dialog',
  standalone: true,
  imports: [CommonModule, CodeEditorComponent],
  template: `
    <div class="dialog-overlay" (click)="close.emit()">
      <div class="dialog-content" (click)="$event.stopPropagation()">
        <div class="dialog-header">
          <h2>Code Snippets</h2>
          <button class="close-btn" (click)="close.emit()">✕</button>
        </div>
        
        <div class="dialog-body">
          <div class="snippet-tabs">
            <button *ngFor="let g of generators"
                    [class.active]="selectedId === g.id"
                    (click)="setLang(g.id)">{{ g.label }}</button>
          </div>

          <div class="editor-wrapper">
            <app-code-editor
              [content]="snippetText"
              [language]="$any(editorLang)"
              [readonly]="true"
              [hideToolbar]="false"
              [title]="activeLabel + ' Snippet'">
            </app-code-editor>
          </div>
        </div>

        <div class="dialog-footer">
          <button class="btn-primary" (click)="copySnippet()">Copy to Clipboard</button>
          <button class="btn-secondary" (click)="close.emit()">Close</button>
        </div>
      </div>
    </div>
  `,
  styles: [`
    .dialog-overlay {
      position: fixed;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      background: rgba(0, 0, 0, 0.7);
      display: flex;
      align-items: center;
      justify-content: center;
      z-index: 10000;
      backdrop-filter: blur(4px);
    }
    .dialog-content {
      background: var(--surface);
      width: 800px;
      max-width: 90vw;
      height: 600px;
      max-height: 90vh;
      border-radius: 12px;
      display: flex;
      flex-direction: column;
      box-shadow: 0 20px 40px rgba(0, 0, 0, 0.4);
      border: 1px solid var(--border-color);
      overflow: hidden;
    }
    .dialog-header {
      padding: 1rem 1.5rem;
      border-bottom: 1px solid var(--border-color);
      display: flex;
      justify-content: space-between;
      align-items: center;
      background: var(--surface-alt);

      h2 { margin: 0; font-size: 1.25rem; color: var(--text-color); }
      .close-btn { 
        background: none; border: none; color: var(--text-color); 
        font-size: 1.25rem; cursor: pointer; opacity: 0.5; transition: opacity 0.2s;
        &:hover { opacity: 1; }
      }
    }
    .dialog-body {
      flex: 1;
      padding: 1.5rem;
      display: flex;
      flex-direction: column;
      gap: 1rem;
      min-height: 0;
    }
    .snippet-tabs {
      display: flex;
      gap: 0.5rem;
      border-bottom: 2px solid var(--border-color);
      padding-bottom: 0.5rem;

      button {
        padding: 0.5rem 1.5rem;
        background: transparent;
        border: none;
        color: var(--text-color);
        opacity: 0.6;
        cursor: pointer;
        font-weight: 600;
        border-bottom: 2px solid transparent;
        margin-bottom: -0.5rem;
        transition: all 0.2s;

        &:hover { opacity: 1; background: var(--surface-alt); }
        &.active { 
          opacity: 1; 
          color: var(--secondary-color); 
          border-bottom-color: var(--secondary-color);
        }
      }
    }
    .editor-wrapper {
      flex: 1;
      min-height: 0;
      border: 1px solid var(--border-color);
      border-radius: 8px;
      overflow: hidden;
    }
    .dialog-footer {
      padding: 1rem 1.5rem;
      border-top: 1px solid var(--border-color);
      display: flex;
      justify-content: flex-end;
      gap: 0.75rem;
      background: var(--surface-alt);
    }
    .btn-primary {
      background: var(--secondary-color);
      color: white;
      border: none;
      padding: 0.6rem 1.25rem;
      border-radius: 6px;
      font-weight: 600;
      cursor: pointer;
      &:hover { opacity: 0.9; }
    }
    .btn-secondary {
      background: transparent;
      color: var(--text-color);
      border: 1px solid var(--border-color);
      padding: 0.6rem 1.25rem;
      border-radius: 6px;
      font-weight: 600;
      cursor: pointer;
      &:hover { background: var(--surface); }
    }
  `]
})
export class CodeSnippetsDialogComponent implements OnInit {
  @Input() request!: Request;
  @Output() close = new EventEmitter<void>();

  generators: SnippetGenerator[] = [];
  selectedId: string = 'curl';
  snippetText: string = '';
  editorLang: SnippetEditorLang = 'plain';
  activeLabel = 'cURL';

  constructor(private snippetService: SnippetService) { }

  ngOnInit() {
    this.generators = this.snippetService.getGenerators();
    this.updateSnippet();
  }

  setLang(id: string) {
    this.selectedId = id;
    this.updateSnippet();
  }

  private updateSnippet() {
    const gen = this.snippetService.getGenerator(this.selectedId) || this.generators[0];
    if (!gen) return;
    this.snippetText = gen.generate(this.request);
    this.editorLang = gen.editorLang;
    this.activeLabel = gen.label;
  }

  copySnippet() {
    navigator.clipboard.writeText(this.snippetText);
  }
}
