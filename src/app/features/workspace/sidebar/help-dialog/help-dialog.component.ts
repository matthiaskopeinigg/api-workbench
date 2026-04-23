import {
  ChangeDetectionStrategy,
  Component,
  EventEmitter,
  HostListener,
  Output,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { WindowService } from '@core/platform/window.service';

/**
 * In-app help: environments, variable syntax, dynamic placeholders, and mock server.
 * Opened from the activity bar via {@link SidebarComponent}.
 */
@Component({
  selector: 'app-help-dialog',
  standalone: true,
  imports: [CommonModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div
      class="help-backdrop"
      role="presentation"
      (click)="onBackdrop($event)"
      aria-hidden="true"
    ></div>
    <div
      class="help-panel"
      role="dialog"
      aria-modal="true"
      aria-labelledby="help-dialog-title"
      (click)="$event.stopPropagation()"
    >
      <header class="help-header">
        <h2 id="help-dialog-title">Help</h2>
        <button
          type="button"
          class="help-close"
          (click)="close()"
          aria-label="Close help"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true">
            <path d="M6 6l12 12M18 6L6 18" />
          </svg>
        </button>
      </header>

      <div class="help-body">
        <p class="help-wiki-top">
          <a
            class="help-wiki-link"
            [href]="wikiUrl"
            target="_blank"
            rel="noopener noreferrer"
          >Full documentation on GitHub Wiki →</a>
        </p>
        <div ngNonBindable>
        <section>
          <h3>Environments &amp; variables</h3>
          <p>
            Define keys and values under <strong>Environments</strong> in the sidebar. Choose an
            environment for the current request on the <strong>request</strong> tab (dropdown next
            to Params / Headers). Folder and environment variables are merged: environment values
            override folder values when a key exists in both.
          </p>
          <p>
            In the URL, query params, headers, auth fields, and body, reference a variable with
            <code>{{variableName}}</code> (double braces around the name). The value is replaced when
            the request is sent. Unknown names are left as literal text.
          </p>
          <p class="tip">
            <span class="tip-label">Tip</span>
            In text fields, type <code>{{</code> to get autocomplete for your current environment and
            folder variable names. Known variables are highlighted in the field.
          </p>
        </section>

        <section>
          <h3>Dynamic placeholders</h3>
          <p>
            After environment substitution, the app can insert fresh values for each request using
            <code>$</code> placeholders (similar to other API clients).
          </p>
          <ul>
            <li><code>$uuid</code> — random UUID (v4) per request</li>
            <li><code>$timestamp</code> — milliseconds (when the request is sent)</li>
            <li><code>$isoTimestamp</code> / <code>$isoDate</code> — ISO-8601 time (UTC)</li>
            <li>
              <code>$randomInt</code> and <code>$randomLong</code> — default 9 random digits, or
              <code>$randomInt(5)</code> for exactly 5 random digits (1–20 digits)
            </li>
          </ul>
          <p>
            You can also wrap these in double braces, e.g. <code>{{$uuid}}</code>, in the same places
            as environment variables. Type <code>$</code> in a field to see autocomplete.
          </p>
        </section>

        <section>
          <h3>Mock server</h3>
          <p>
            Use <strong>Mock Server</strong> in the activity bar: it opens the Mock Server tab and an
            <strong>Endpoints</strong> side panel (collection routes with mock variants, plus standalone
            routes you define there). Start the server from the tab to see the local <strong>base URL</strong>.
          </p>
          <p>
            <strong>Collection mocks</strong> — add one or more variants on a saved request, choose which is
            <em>active</em>, then call <code>/mock/&lt;requestId&gt;</code> on the mock origin (optional
            <code>/mock/&lt;requestId&gt;/&lt;variantId&gt;</code> to pin a variant). Copy URL actions appear
            in the editor when the server is running.
          </p>
          <p>
            <strong>Standalone mocks</strong> — method + path on the same origin. Paths may end with
            <code>/*</code> (one extra path segment) or <code>/**</code> (that path and everything under it).
          </p>
          <p>
            In each variant, <strong>response body</strong> and <strong>response header values</strong> are
            evaluated per incoming request. These tokens are <em>not</em> the same as environment
            <code>{{variableName}}</code> on outbound requests; they are expanded by the mock process:
          </p>
          <ul>
            <li><code>{{header.Authorization}}</code> — raw header value (name matched case-insensitively)</li>
            <li><code>{{headerJson.Authorization}}</code> — same value as a JSON string literal (safe inside JSON)</li>
            <li><code>{{body}}</code> — raw captured request body text</li>
            <li><code>{{bodyJson}}</code> — whole body as a JSON string literal (for embedding)</li>
            <li>
              <code>{{bodyJson.accessToken}}</code>, <code>{{bodyJson.user.id}}</code> — dot path into the
              <em>parsed JSON</em> request body; replaced with <code>JSON.stringify</code> of that value,
              or <code>null</code> if missing / invalid JSON
            </li>
          </ul>
          <p class="tip">
            <span class="tip-label">Tip</span>
            Turn on <strong>Capture request &amp; response bodies</strong> (Mock Server → Advanced) so
            <code>{{body}}</code> / <code>{{bodyJson…}}</code> receive the client request body. Dynamic
            snippets in mock bodies (e.g. echoing a token) are documented in the variant editor hint as well.
          </p>
          <p>
            The tab also has an <strong>activity</strong> log of hits, filters, optional request/response body
            capture in the log, CORS and default delay options, and <strong>auto-start</strong> in Advanced.
          </p>
        </section>

        <section>
          <h3>Path segments in the URL</h3>
          <p>
            In the <strong>request URL</strong> only, segments like <code>:id</code> are highlighted
            as path parameters. Add matching path params in the <strong>Params</strong> tab
            (type: path) so you can set values and descriptions.
          </p>
        </section>

        <section>
          <h3>Other tips</h3>
          <ul>
            <li>Collections, folders, and requests are stored locally; use your backup workflow (e.g. file sync or VCS) for sharing.</li>
            <li><strong>History</strong> records sent requests; open a past entry to resend or compare.</li>
            <li>
              Application preferences (default headers, SSL, theme, and more) live under the
              <strong>Settings</strong> control in the title bar.
            </li>
          </ul>
        </section>
      </div>

      <footer class="help-footer">
        <button type="button" class="help-done" (click)="close()">Done</button>
      </footer>
    </div>
  `,
  styles: [
    `
    :host {
      position: fixed;
      inset: 0;
      z-index: 10050;
      display: grid;
      place-items: center;
      padding: 24px 16px;
      pointer-events: none;
    }
    :host > * {
      pointer-events: auto;
    }
    .help-backdrop {
      position: fixed;
      inset: 0;
      background: color-mix(in srgb, #000, transparent 45%);
      pointer-events: auto;
    }
    .help-panel {
      position: relative;
      z-index: 1;
      width: min(100%, 34rem);
      max-height: min(88vh, 720px);
      display: flex;
      flex-direction: column;
      background: var(--aw-chrome-surface, var(--surface, #1e1e1e));
      color: var(--aw-text, var(--text-color, #e8e8e8));
      border: 1px solid var(--aw-border, var(--border-color, #333));
      border-radius: var(--aw-radius-md, 10px);
      box-shadow: var(--aw-shadow-lg, 0 16px 48px rgba(0,0,0,0.45));
    }
    .help-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 14px 16px 12px 18px;
      border-bottom: 1px solid var(--aw-border, var(--border-color));
      flex-shrink: 0;
    }
    .help-header h2 {
      margin: 0;
      font-size: 1.05rem;
      font-weight: 700;
      letter-spacing: -0.02em;
    }
    .help-close {
      display: grid;
      place-items: center;
      width: 32px;
      height: 32px;
      border: 0;
      border-radius: 8px;
      background: transparent;
      color: color-mix(in srgb, var(--aw-text, var(--text-color)), transparent 40%);
      cursor: pointer;
      transition: background-color 120ms ease, color 120ms ease;
    }
    .help-close:hover {
      background: color-mix(in srgb, var(--aw-text, var(--text-color)), transparent 90%);
      color: var(--aw-text, var(--text-color));
    }
    .help-body {
      padding: 12px 18px 16px;
      overflow-y: auto;
      font-size: 0.86rem;
      line-height: 1.5;
    }
    .help-wiki-top {
      margin: 0 0 0.75rem 0;
      padding-bottom: 0.75rem;
      border-bottom: 1px solid color-mix(in srgb, var(--aw-border, var(--border-color)), transparent 30%);
    }
    .help-wiki-link {
      font-size: 0.88rem;
      font-weight: 600;
      color: var(--secondary-color, #f5a623);
      text-decoration: none;
    }
    .help-wiki-link:hover {
      text-decoration: underline;
    }
    .help-body h3 {
      margin: 1.1rem 0 0.45rem;
      font-size: 0.8rem;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.06em;
      color: color-mix(in srgb, var(--aw-text, var(--text-color)), transparent 20%);
    }
    .help-body section:first-child h3 {
      margin-top: 0.15rem;
    }
    .help-body p,
    .help-body li {
      margin: 0.4rem 0;
      color: color-mix(in srgb, var(--aw-text, var(--text-color)), transparent 8%);
    }
    .help-body ul {
      margin: 0.35rem 0 0.5rem 1.1rem;
      padding: 0;
    }
    .help-body code {
      font-family: var(--aw-font-mono, ui-monospace, SFMono-Regular, Menlo, Consolas, monospace);
      font-size: 0.86em;
      padding: 0.1em 0.35em;
      border-radius: 4px;
      background: color-mix(in srgb, var(--aw-text, var(--text-color)), transparent 91%);
    }
    .tip {
      display: flex;
      flex-direction: column;
      gap: 6px;
      padding: 10px 12px;
      border-radius: 8px;
      background: color-mix(in srgb, var(--secondary-color, #f5a623), transparent 90%);
      border: 1px solid color-mix(in srgb, var(--secondary-color, #f5a623), transparent 80%);
    }
    .tip-label {
      font-size: 0.68rem;
      font-weight: 800;
      text-transform: uppercase;
      letter-spacing: 0.08em;
      color: var(--secondary-color, #f5a623);
    }
    .help-footer {
      display: flex;
      justify-content: flex-end;
      padding: 10px 16px 14px;
      border-top: 1px solid var(--aw-border, var(--border-color));
      flex-shrink: 0;
    }
    .help-done {
      padding: 8px 18px;
      border-radius: 8px;
      font-weight: 600;
      font-size: 0.85rem;
      cursor: pointer;
      border: 1px solid var(--secondary-color, #f5a623);
      background: var(--secondary-color, #f5a623);
      color: var(--surface, #111);
    }
    .help-done:hover {
      filter: brightness(1.05);
    }
  `,
  ],
})
export class HelpDialogComponent {
  /** GitHub Wiki (enable Wiki in repo settings if the link 404s). */
  readonly wikiUrl = 'https://github.com/matthiaskopeinigg/api-workbench/wiki';

  @Output() closed = new EventEmitter<void>();

  constructor(private windowService: WindowService) {}

  /** Opens the wiki in the default browser (Electron: `shell.openExternal`, not an in-app window). */
  onWikiLinkClick(event: Event): void {
    event.preventDefault();
    this.windowService.openUrlInSystemBrowser(this.wikiUrl);
  }

  onBackdrop(_event: MouseEvent): void {
    this.close();
  }

  close(): void {
    this.closed.emit();
  }

  @HostListener('document:keydown', ['$event'])
  onKeydown(e: KeyboardEvent): void {
    if (e.key === 'Escape') {
      e.preventDefault();
      this.close();
    }
  }
}
