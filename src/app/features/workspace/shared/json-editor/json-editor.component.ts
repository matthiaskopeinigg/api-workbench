import { ChangeDetectionStrategy, Component, EventEmitter, Input, Output } from '@angular/core';
import { CodeEditorComponent, EditorLanguage } from '../code-editor/code-editor.component';

@Component({
  selector: 'app-json-editor',
  standalone: true,
  imports: [CodeEditorComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="wrap" [style.minHeight.px]="minHeight" [style.maxHeight.px]="maxHeight">
      <app-code-editor
        [language]="editorType === 'javascript' ? 'javascript' : 'json'"
        [content]="jsonString"
        (contentChange)="jsonChange.emit($event)"
        [readonly]="readonly"
        [activeVariables]="activeVariables"
        [hideToolbar]="true"
      />
    </div>
  `,
  styles: [
    `
      :host {
        display: flex;
        flex: 1;
        flex-direction: column;
        min-height: 0;
      }
      .wrap {
        flex: 1;
        display: flex;
        flex-direction: column;
        min-height: 0;
      }
    `,
  ],
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
