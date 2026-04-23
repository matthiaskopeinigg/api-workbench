import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  Input,
  ViewChild,
  ViewEncapsulation,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { SafeHtmlPipe } from '@shared-app/pipes/safe-html.pipe';

/**
 * Renders JS syntax HTML in a closed shadow root so token &lt;span&gt; nodes are not in the same
 * light-DOM tree as the textarea (Chromium/Electron could merge that markup into the field value).
 */
@Component({
  selector: 'app-code-js-highlight-mirror',
  standalone: true,
  imports: [CommonModule, SafeHtmlPipe],
  encapsulation: ViewEncapsulation.ShadowDom,
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './code-js-highlight-mirror.component.html',
  styleUrl: './code-js-highlight-mirror.component.scss',
})
export class CodeJsHighlightMirrorComponent {
  @Input() html = '';

  @ViewChild('scrollPre') private scrollPre!: ElementRef<HTMLPreElement>;

  syncFromTextarea(scrollTop: number, scrollLeft: number): void {
    const pre = this.scrollPre?.nativeElement;
    if (!pre) {
      return;
    }
    pre.scrollTop = scrollTop;
    pre.scrollLeft = scrollLeft;
  }
}
