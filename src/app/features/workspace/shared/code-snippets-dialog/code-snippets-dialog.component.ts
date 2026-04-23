import { Component, Input, Output, EventEmitter, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Request } from '@models/request';
import { SnippetService, SnippetGenerator, SnippetEditorLang } from '@core/snippets/snippet.service';
import { CodeEditorComponent } from '../code-editor/code-editor.component';

@Component({
  selector: 'app-code-snippets-dialog',
  standalone: true,
  imports: [CommonModule, CodeEditorComponent],
  templateUrl: './code-snippets-dialog.component.html',

  styleUrl: './code-snippets-dialog.component.scss',
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
