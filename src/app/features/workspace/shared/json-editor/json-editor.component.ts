import { ChangeDetectionStrategy, Component, EventEmitter, Input, Output } from '@angular/core';
import { CodeEditorComponent, EditorLanguage } from '../code-editor/code-editor.component';

@Component({
  selector: 'app-json-editor',
  standalone: true,
  imports: [CodeEditorComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './json-editor.component.html',

  styleUrl: './json-editor.component.scss',
})
export class JsonEditorComponent {
  @Input() editorType: 'json' | 'javascript' = 'json';
  @Input() jsonString = '';
  @Input() readonly = false;
  @Input() minHeight = 60;
  @Input() maxHeight = 500;
  @Input() activeVariables: Record<string, string> = {};

  @Output() jsonChange = new EventEmitter<string>();
}
