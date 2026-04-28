import { ChangeDetectionStrategy, ChangeDetectorRef, Component, EventEmitter, OnDestroy, OnInit, Output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormArray, FormBuilder, FormGroup, ReactiveFormsModule, Validators, FormControl } from '@angular/forms';
import { Subject, Subscription } from 'rxjs';
import { debounceTime, takeUntil } from 'rxjs/operators';
import { v4 as uuidv4 } from 'uuid';
import { Certificate, DatabaseConnection, RequestEditorSection, Settings, Theme } from '@models/settings';
import {
  KEYBOARD_SHORTCUT_CATALOG,
  type KeyboardShortcutDefinition,
} from '@core/keyboard/keyboard-shortcut-catalog';
import { validateBindingMap, serializeChordFromEvent } from '@core/keyboard/chord-matcher';
import { HttpMethod } from '@models/request';
import { ConfirmDialogService } from '@core/ui/confirm-dialog.service';
import { SettingsService } from '@core/settings/settings.service';

import { ThemeService } from '@core/settings/theme.service';
import { FileDialogService } from '@core/platform/file-dialog.service';
import { CollectionService } from '@core/collection/collection.service';
import { ImportService } from '@core/import-pipeline/import.service';
import { BatchImportDialogService } from '@core/import-pipeline/batch-import-dialog.service';
import type { ReadImportFolderOptions } from '@models/file-dialog';
import { UpdateService } from '@core/platform/update.service';
import { Collection, Folder } from '@models/collection';
import type { StorageInfo, UpdaterStatus } from '@models/electron';
import { DropdownComponent, DropdownOption } from '../../shared/dropdown/dropdown.component';
import { EnvironmentsService } from '@core/environments/environments.service';
import { SessionService } from '@core/session/session.service';
import { cleanKv } from '@core/utils/kv-utils';
import { VariableInputComponent } from '@shared-app/components/variable-input/variable-input.component';
import { BugReportHintComponent } from '../../shared/bug-report-hint/bug-report-hint.component';

/** Same key as {@link RequestComponent} — values merged into default-header placeholder map. */
const SESSION_SCRIPT_VARS_KEY = 'awScriptRuntimeVariables';

@Component({
  selector: 'app-settings',
  imports: [CommonModule, ReactiveFormsModule, DropdownComponent, VariableInputComponent, BugReportHintComponent],
  templateUrl: './settings.component.html',
  styleUrls: ['./settings.component.scss'],
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SettingsComponent implements OnInit, OnDestroy {

  @Output() close = new EventEmitter<void>();

  updaterStatus: UpdaterStatus | null = null;
  private updaterSub?: Subscription;
  private batchImportSub?: Subscription;

  settingsForm!: FormGroup;
  themes: Theme[] = [Theme.SYSTEM, ...(Object.values(Theme).filter((t) => t !== Theme.SYSTEM) as Theme[])];
  httpMethods = Object.keys(HttpMethod).filter(k => isNaN(Number(k)));
  httpMethodOptions: DropdownOption[] = this.httpMethods.map(m => ({ label: m, value: m }));

  folderClickBehaviorOptions: DropdownOption[] = [
    { label: 'Open as Tab & Expand', value: 'both' },
    { label: 'Open as Tab Only', value: 'open' },
    { label: 'Expand Only', value: 'expand' }
  ];

  defaultRequestEditorSectionOptions: DropdownOption[] = [
    { label: 'Params', value: 'params' as RequestEditorSection },
    { label: 'Headers', value: 'headers' as RequestEditorSection },
    { label: 'Body', value: 'body' as RequestEditorSection },
    { label: 'Scripts', value: 'scripts' as RequestEditorSection },
    { label: 'Auth', value: 'auth' as RequestEditorSection },
    { label: 'Settings', value: 'settings' as RequestEditorSection },
  ];

  proxyTypeOptions: DropdownOption[] = [
    { label: 'HTTP', value: 'http' },
    { label: 'HTTPS', value: 'https' },
    { label: 'SOCKS5', value: 'socks5' },
    { label: 'SOCKS5 (remote DNS)', value: 'socks5h' },
    { label: 'SOCKS4', value: 'socks4' },
    { label: 'SOCKS (legacy alias for SOCKS5)', value: 'socks' }
  ];

  selectedTab: string = 'ui';

  /**
   * Sidebar layout for the settings modal. Grouping by domain (General / Network / Data)
   * makes the navigation scannable as the surface grows. Icons are stored inline as SVG
   * `path` data so the template can render them with a single `<svg>` element.
   */
  readonly sidebarSections: ReadonlyArray<{
    title: string;
    items: ReadonlyArray<{ id: string; label: string; icon: string }>;
  }> = [
    {
      title: 'General',
      items: [
        { id: 'ui', label: 'User Interface', icon: 'M3 5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2h-5l1 3h2v2H7v-2h2l1-3H5a2 2 0 0 1-2-2z' },
        {
          id: 'keyboard',
          label: 'Keyboard',
          icon: 'M4 6h16v2H4zm0 5h16v2H4zm0 5h10v2H4z',
        },
        { id: 'requests', label: 'Requests', icon: 'M2 21l21-9L2 3v7l15 2-15 2z' },
        { id: 'retries', label: 'Retries', icon: 'M17.65 6.35A8 8 0 1 0 19.73 14h-2.07A6 6 0 1 1 12 6c1.66 0 3.14.69 4.22 1.78L13 11h7V4z' },
        {
          id: 'logging',
          label: 'Logging',
          icon: 'M4 4h16v2H4zm0 5h10v2H4zm0 5h16v2H4zm0 5h10v2H4z',
        },
      ],
    },
    {
      title: 'Network',
      items: [
        { id: 'headers', label: 'Headers', icon: 'M3 5h18v2H3zm0 6h18v2H3zm0 6h12v2H3z' },
        { id: 'certificates', label: 'Certificates', icon: 'M12 1 3 5v6c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V5z' },
        { id: 'dns', label: 'DNS', icon: 'M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm0 18c-1.1 0-2.13-.18-3.1-.51a14.5 14.5 0 0 0 1.41-4.49h3.38a14.5 14.5 0 0 0 1.41 4.49A8 8 0 0 1 12 20zm-3.5-7c-.07-.65-.11-1.32-.11-2s.04-1.35.11-2h7c.07.65.11 1.32.11 2s-.04 1.35-.11 2zM4 12c0-.69.07-1.36.2-2h2.34c-.06.65-.1 1.32-.1 2s.04 1.35.1 2H4.2c-.13-.64-.2-1.31-.2-2zm15.8-2c.13.64.2 1.31.2 2s-.07 1.36-.2 2h-2.34c.06-.65.1-1.32.1-2s-.04-1.35-.1-2zM12 4c1.1 0 2.13.18 3.1.51a14.5 14.5 0 0 0-1.41 4.49h-3.38a14.5 14.5 0 0 0-1.41-4.49A8 8 0 0 1 12 4z' },
        { id: 'proxy', label: 'Proxy', icon: 'M4 4h6v6H4zm10 0h6v6h-6zM4 14h6v6H4zm12 0h4v2h-4zm0 4h4v2h-4z' },
      ],
    },
    {
      title: 'Data',
      items: [
        { id: 'data', label: 'Data & config', icon: 'M3 5h3l1.5-2h6L12 5h7a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2z' },
        { id: 'databases', label: 'Databases', icon: 'M12 2C6.48 2 2 4.01 2 6.5s4.48 4.5 10 4.5 10-2.01 10-4.5S17.52 2 12 2zm0 18c-5.52 0-10-2.01-10-4.5V18c0 2.49 4.48 4.5 10 4.5s10-2.01 10-4.5v-1.5c0 2.49-4.48 4.5-10 4.5zM2 11.5v3c0 2.49 4.48 4.5 10 4.5s10-2.01 10-4.5v-3c0 2.49-4.48 4.5-10 4.5s-10-2.01-10-4.5z' },
        { id: 'export-import', label: 'Export & Import', icon: 'M19 9h-4V3H9v6H5l7 7zM5 18v2h14v-2z' },
        { id: 'about', label: 'About', icon: 'M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm1 15h-2v-6h2zm0-8h-2V7h2z' },
      ],
    },
  ];

  editingIndex: number | null = null;
  hostnameControl = new FormControl('', Validators.required);
  passphraseControl = new FormControl('');
  newCertFiles = { crtFilePath: '', keyFilePath: '', pfxFilePath: '' };
  showPassphrase = false;

  collectionsExist = false;

  /** User overrides for keyboard shortcuts (merged on save). */
  keyboardBindings: Record<string, string> = {};
  bindCaptureActionId: string | null = null;
  bindingError: string | null = null;
  readonly keyboardCatalog: readonly KeyboardShortcutDefinition[] = KEYBOARD_SHORTCUT_CATALOG;
  private captureKeydownUnlisten?: () => void;

  importMessage: string | null = null;
  showPopup = false;
  importFailed = false;
  isLoading = false;

  /** DB row index currently running "Test connection" (inline spinner only). */
  testingDbIndex: number | null = null;
  /** Inline success/error for the last test, scoped to `index`. */
  dbTestFeedback: { index: number; message: string; error: boolean } | null = null;

  storageInfo: StorageInfo | null = null;
  /** Messages from Change / Reset work directory (separate from settings Save). */
  dataMessage: string | null = null;
  /** Which path row last triggered a successful clipboard copy (`userData` | `workspace` | …). */
  pathCopyFeedbackKey: string | null = null;
  private pathCopyClearTimer: ReturnType<typeof setTimeout> | null = null;

  /** Serialized baseline after load or successful auto-save — form + keyboard (non-database sections). */
  private settingsBaselineJson: string | null = null;
  /** Baseline for the Databases tab only (explicit Save / Cancel). */
  private databasesBaselineJson: string | null = null;
  private themePreviewSub?: Subscription;
  private compactPreviewSub?: Subscription;
  private autoSaveSub?: Subscription;
  saveInProgress = false;

  /** Active environment + session script vars — drives `{{name}}` completion and highlighting in default headers. */
  headerFieldVariables: Record<string, string> = {};

  private readonly destroy$ = new Subject<void>();

  get hasStorageApi(): boolean {
    return typeof window !== 'undefined' && typeof window.awElectron?.getStorageInfo === 'function';
  }

  constructor(
    private fb: FormBuilder,
    private config: SettingsService,
    private themeService: ThemeService,

    private fileDialogService: FileDialogService,
    private collectionService: CollectionService,

    private importService: ImportService,
    private batchImportDialog: BatchImportDialogService,
    private updateService: UpdateService,
    private environmentsService: EnvironmentsService,
    private sessionService: SessionService,
    private confirmDialog: ConfirmDialogService,
    private cdr: ChangeDetectorRef
  ) { }

  async ngOnInit() {
    await this.loadSettings();
    await this.sessionService.load(SESSION_SCRIPT_VARS_KEY);
    await this.environmentsService.loadEnvironments();
    this.rebuildHeaderFieldVariables();
    this.environmentsService
      .getActiveContextAsObservable()
      .pipe(takeUntil(this.destroy$))
      .subscribe(() => {
        this.rebuildHeaderFieldVariables();
        this.cdr.markForCheck();
      });
    void this.refreshStorageInfo();
    this.updaterSub = this.updateService.statusStream.subscribe((status) => {
      this.updaterStatus = status;
      this.cdr.markForCheck();
    });
    this.batchImportSub = this.batchImportDialog.finished$.subscribe((result) => {
      if (result == null) {
        return;
      }
      const cols = this.collectionService.getCollections();
      this.collectionsExist = cols.length > 0;
      this.cdr.markForCheck();
    });
  }

  ngOnDestroy(): void {
    this.endBindingCapture();
    if (this.pathCopyClearTimer) {
      clearTimeout(this.pathCopyClearTimer);
      this.pathCopyClearTimer = null;
    }
    this.autoSaveSub?.unsubscribe();
    this.themePreviewSub?.unsubscribe();
    this.compactPreviewSub?.unsubscribe();
    this.destroy$.next();
    this.destroy$.complete();
    this.updaterSub?.unsubscribe();
    this.batchImportSub?.unsubscribe();
  }

  private rebuildHeaderFieldVariables(): void {
    const next: Record<string, string> = {};
    const ctx = this.environmentsService.getActiveContext();
    for (const v of cleanKv(ctx?.variables)) {
      next[String(v.key)] = String(v.value ?? '');
    }
    const raw = this.sessionService.get(SESSION_SCRIPT_VARS_KEY) as Record<string, unknown> | null;
    if (raw && typeof raw === 'object') {
      for (const [k, v] of Object.entries(raw)) {
        next[String(k)] = v == null ? '' : String(v);
      }
    }
    this.headerFieldVariables = next;
  }

  checkForUpdates(): void {
    void this.updateService.checkForUpdates();
  }

  downloadAndInstallUpdate(): void {
    this.updateService.downloadAndInstall();
  }

  installUpdate(): void {
    this.updateService.installUpdate();
  }

  get isAutomaticInstall(): boolean {
    return this.updateService.isAutomaticInstall;
  }

  get updateStatusMessage(): string {
    const s = this.updaterStatus;
    if (!s) return 'Checking\u2026';
    switch (s.state) {
      case 'disabled':
        return s.info?.reason ?? 'Auto-update is disabled.';
      case 'idle':
        if (s.info?.devReadOnly) {
          return (
            `You are running v${s.currentVersion} (development). ` +
            'The app checks GitHub for newer releases on startup; download and install stay disabled here.'
          );
        }
        if (!s.supported) {
          return s.info?.reason ?? 'Auto-update is only available in packaged builds.';
        }
        return `You are running version ${s.currentVersion}.`;
      case 'checking':
        return !s.supported
          ? 'Checking GitHub for newer releases\u2026'
          : 'Checking for updates\u2026';
      case 'not-available':
        if (s.info?.noReleaseChannel) {
          return 'No new version found.';
        }
        if (s.info?.devReadOnly) {
          const latest = s.info?.version;
          return latest
            ? `No newer version on GitHub (latest published: v${latest}; you are on v${s.currentVersion}).`
            : 'No newer version on GitHub.';
        }
        return `You\u2019re on the latest version (${s.currentVersion}).`;
      case 'available':
        if (!s.supported && s.info?.devPreviewOnly) {
          return (
            `Newer release on GitHub: v${s.info?.version ?? ''}. ` +
            'Download a packaged installer from the repository releases page to update.'
          );
        }
        return `Version ${s.info?.version ?? ''} is available. Use Download and install, or use the banner at the bottom of the window.`;
      case 'downloading': {
        const p = s.info?.percent ?? 0;
        return `Downloading update\u2026 ${p}%`;
      }
      case 'downloaded':
        return this.isAutomaticInstall
          ? 'The app will restart now to install the update.'
          : `Version ${s.info?.version ?? ''} is ready. The app will restart for the installer, or use Restart & install.`;
      case 'error': {
        const m = s.info?.message ?? '';
        if (/CHANNEL_FILE_NOT_FOUND|Cannot find .*\.yml|latest\.yml|beta\.yml/i.test(m)) {
          return 'No new version found.';
        }
        return m ? `Couldn\u2019t check for updates: ${m}` : `Couldn\u2019t check for updates. Please try again later.`;
      }
      default: return '';
    }
  }

  private async loadSettings() {
    const settings = this.config.getSettings();

    this.settingsForm = this.fb.group({
      ui: this.fb.group({
        theme: [settings?.ui?.theme ?? Theme.SYSTEM, Validators.required],
        closeSidebarOnOutsideClick: [settings?.ui?.closeSidebarOnOutsideClick ?? true],
        saveOpenTabs: [settings?.ui?.saveOpenTabs ?? true],
        folderClickBehavior: [settings?.ui?.folderClickBehavior ?? 'both'],
        compactMode: [settings?.ui?.compactMode ?? false],
        hideRequestMethod: [settings?.ui?.hideRequestMethod ?? false]
      }),

      requests: this.fb.group({
        defaultHttpMethod: [this.normalizeDefaultHttpMethodForForm(settings?.requests?.defaultHttpMethod)],
        defaultRequestEditorSection: [
          (settings?.requests?.defaultRequestEditorSection ?? 'params') as RequestEditorSection,
        ],
        timeoutMs: [settings?.requests?.timeoutMs ?? 0],
        useCookies: [settings?.requests?.useCookies ?? true],
        allowHttp2: [settings?.requests?.allowHttp2 ?? false]
      }),

      retries: this.fb.group({
        retryOnFailure: [settings?.retries?.retryOnFailure ?? false],
        retryCount: [settings?.retries?.retryCount ?? 0],
        retryDelayMs: [settings?.retries?.retryDelayMs ?? 300],
        exponentialBackoff: [settings?.retries?.exponentialBackoff ?? false]
      }),

      headers: this.fb.group({
        addDefaultHeaders: [settings?.headers?.addDefaultHeaders ?? false],
        defaultHeaders: this.fb.array(
          (settings?.headers?.defaultHeaders || []).map(h => this.fb.group({
            key: [h.key || ''],
            value: [h.value || ''],
            enabled: [h.enabled ?? true]
          }))
        )
      }),

      ssl: this.fb.group({
        ignoreInvalidSsl: [settings?.ssl?.ignoreInvalidSsl ?? false],
        verifyHostname: [settings?.ssl?.verifyHostname ?? true],
        useSystemCaStore: [settings?.ssl?.useSystemCaStore ?? true],
        customCaPaths: [settings?.ssl?.customCaPaths ?? []],
        certificates: this.fb.array(
          (settings?.ssl?.certificates || []).map(c => this.createCertificateGroup(c))
        )
      }),

      dns: this.fb.group({
        customDnsServer: [settings?.dns?.customDnsServer ?? null]
      }),

      proxy: this.fb.group({
        useSystem: [settings?.proxy?.useSystem ?? true],
        type: [settings?.proxy?.type ?? 'http'],
        host: [settings?.proxy?.host ?? ''],
        port: [settings?.proxy?.port ?? 0],
        user: [settings?.proxy?.user ?? ''],
        password: [settings?.proxy?.password ?? ''],
        noProxy: [settings?.proxy?.noProxy ?? []]
      }),
      logging: this.fb.group({
        enableRequestLogging: [settings?.logging?.enableRequestLogging ?? false],
        enableResponseLogging: [settings?.logging?.enableResponseLogging ?? false],
        logToFile: [settings?.logging?.logToFile ?? false],
        logFilePath: [settings?.logging?.logFilePath ?? ''],
        maxLogFileSizeKb: [settings?.logging?.maxLogFileSizeKb ?? 1024],
      }),
      databases: this.fb.group({
        connections: this.fb.array(
          (settings?.databases?.connections || []).map(c => this.createDatabaseConnectionGroup(c))
        )
      })
    });

    const collections = this.collectionService.getCollections();
    this.collectionsExist = collections.length > 0;

    await this.themeService.setTheme(this.settingsForm.get('ui.theme')?.value, false);
    this.keyboardBindings = { ...(settings.keyboard?.bindings ?? {}) };
    this.bindSettingsPreviewSubscriptions();
    this.subscribeToDebouncedAutoSave();
    this.captureSettingsBaseline();
    this.captureDatabasesBaseline();
    this.cdr.markForCheck();
  }

  defaultChordFor(def: KeyboardShortcutDefinition): string {
    return def.defaultChord;
  }

  /** Effective chord shown in the table (override or default). */
  displayChordFor(def: KeyboardShortcutDefinition): string {
    const o = this.keyboardBindings[def.id];
    return (o && o.trim()) || def.defaultChord;
  }

  formatChordForDisplay(chord: string): string {
    if (typeof navigator !== 'undefined' && /Mac|iPhone|iPod|iPad/i.test(navigator.platform)) {
      return chord.replace(/Mod\+/g, '⌘').replace(/Alt\+/g, '⌥').replace(/Shift\+/g, '⇧');
    }
    return chord.replace(/Mod\+/g, 'Ctrl+');
  }

  startBindingCapture(actionId: string): void {
    this.endBindingCapture();
    this.bindCaptureActionId = actionId;
    this.bindingError = null;
    const handler = (ev: KeyboardEvent) => this.onBindingCaptureKeydown(ev);
    window.addEventListener('keydown', handler, true);
    this.captureKeydownUnlisten = () => window.removeEventListener('keydown', handler, true);
    this.cdr.markForCheck();
  }

  private onBindingCaptureKeydown(ev: KeyboardEvent): void {
    if (!this.bindCaptureActionId) return;
    if (ev.key === 'Escape') {
      ev.preventDefault();
      this.endBindingCapture();
      this.cdr.markForCheck();
      return;
    }
    if (ev.repeat) return;
    const chord = serializeChordFromEvent(ev);
    if (!chord.includes('+') && !/^F\d+$/.test(chord)) {
      return;
    }
    ev.preventDefault();
    ev.stopPropagation();
    const id = this.bindCaptureActionId;
    const tentative: Record<string, string> = { ...this.keyboardBindings, [id]: chord };
    const check = validateBindingMap(tentative, KEYBOARD_SHORTCUT_CATALOG.map((d) => d.id));
    if (!check.ok) {
      this.bindingError = check.message;
      this.endBindingCapture();
      this.cdr.markForCheck();
      return;
    }
    this.keyboardBindings = this.pruneEmptyBindings(tentative);
    this.bindingError = null;
    this.endBindingCapture();
    void this.saveFromFormAuto();
    this.cdr.markForCheck();
  }

  endBindingCapture(): void {
    this.bindCaptureActionId = null;
    this.captureKeydownUnlisten?.();
    this.captureKeydownUnlisten = undefined;
  }

  resetBinding(actionId: string): void {
    delete this.keyboardBindings[actionId];
    void this.saveFromFormAuto();
    this.cdr.markForCheck();
  }

  resetAllKeyboardBindings(): void {
    this.keyboardBindings = {};
    void this.saveFromFormAuto();
    this.cdr.markForCheck();
  }

  private pruneEmptyBindings(b: Record<string, string>): Record<string, string> {
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(b)) {
      if (v?.trim()) out[k] = v.trim();
    }
    return out;
  }

  private applyDensityPreview(compact: boolean): void {
    document.documentElement.setAttribute('data-density', compact ? 'compact' : 'comfortable');
  }

  private bindSettingsPreviewSubscriptions(): void {
    this.themePreviewSub?.unsubscribe();
    this.compactPreviewSub?.unsubscribe();

    const themeCtrl = this.settingsForm.get('ui.theme');
    if (themeCtrl) {
      this.themePreviewSub = themeCtrl.valueChanges.pipe(takeUntil(this.destroy$)).subscribe((theme: Theme) => {
        void this.themeService.setTheme(theme, false);
      });
    }

    const compactCtrl = this.settingsForm.get('ui.compactMode');
    if (compactCtrl) {
      this.compactPreviewSub = compactCtrl.valueChanges.pipe(takeUntil(this.destroy$)).subscribe((compact) => {
        this.applyDensityPreview(compact === true);
      });
    }

    this.settingsForm.valueChanges.pipe(takeUntil(this.destroy$)).subscribe(() => {
      this.cdr.markForCheck();
    });
  }

  private subscribeToDebouncedAutoSave(): void {
    this.autoSaveSub?.unsubscribe();
    this.autoSaveSub = this.settingsForm.valueChanges
      .pipe(debounceTime(300), takeUntil(this.destroy$))
      .subscribe(() => {
        void this.saveFromFormAuto();
      });
  }

  /**
   * Settings as they would be written by auto-save: when the Databases tab is active,
   * connection rows from the form are ignored and on-disk profiles are kept instead.
   */
  private buildPersistableSettings(): Settings {
    const settings = this.buildPendingSettings();
    if (this.selectedTab === 'databases') {
      const disk = this.config.getSettings();
      settings.databases = disk.databases
        ? (JSON.parse(JSON.stringify(disk.databases)) as NonNullable<Settings['databases']>)
        : { connections: [] };
    }
    return settings;
  }

  private serializePersistableDraft(): string {
    return JSON.stringify(this.buildPersistableSettings());
  }

  private captureSettingsBaseline(): void {
    this.settingsBaselineJson = this.serializePersistableDraft();
  }

  private captureDatabasesBaseline(): void {
    this.databasesBaselineJson = this.serializeDatabases();
  }

  private serializeDatabases(): string {
    const raw = this.settingsForm?.get('databases')?.getRawValue();
    return JSON.stringify(raw ?? { connections: [] });
  }

  isDatabasesDirty(): boolean {
    if (this.databasesBaselineJson == null) return false;
    return this.serializeDatabases() !== this.databasesBaselineJson;
  }

  private async saveFromFormAuto(): Promise<void> {
    if (this.saveInProgress || !this.settingsForm) return;
    const nextJson = this.serializePersistableDraft();
    if (nextJson === this.settingsBaselineJson) return;
    this.saveInProgress = true;
    this.cdr.markForCheck();
    try {
      const settings = JSON.parse(nextJson) as Settings;
      await this.config.saveSettings(settings);
      await this.themeService.setTheme(settings.ui?.theme ?? Theme.SYSTEM, false);
      this.captureSettingsBaseline();
      if (this.selectedTab !== 'databases') {
        this.captureDatabasesBaseline();
      }
    } finally {
      this.saveInProgress = false;
      this.cdr.markForCheck();
    }
  }

  /** Builds the settings object from the form (same normalization as the former auto-save path). */
  buildPendingSettings(): Settings {
    const value = JSON.parse(JSON.stringify(this.settingsForm.getRawValue())) as Settings;

    if (value.headers?.defaultHeaders) {
      value.headers.defaultHeaders = value.headers.defaultHeaders.filter((h) => String(h.key ?? '').trim());
    }

    if (value.databases?.connections?.length) {
      value.databases.connections = value.databases.connections.map((c) => {
        const row: Record<string, unknown> = { ...c };
        const cmd = Number(row['commandTimeoutMs']);
        if (!Number.isFinite(cmd) || cmd <= 0) {
          delete row['commandTimeoutMs'];
        } else {
          row['commandTimeoutMs'] = cmd;
        }
        return row as unknown as (typeof value.databases)['connections'][number];
      });
    }

    value.keyboard = { bindings: this.pruneEmptyBindings({ ...this.keyboardBindings }) };
    this.applyDefaultHttpMethodEnum(value);
    return value;
  }

  async onSaveDatabaseSection(): Promise<void> {
    if (this.saveInProgress || !this.settingsForm) return;
    this.saveInProgress = true;
    this.cdr.markForCheck();
    try {
      const settings = this.buildPendingSettings();
      await this.config.saveSettings(settings);
      await this.themeService.setTheme(settings.ui?.theme ?? Theme.SYSTEM, false);
      this.settingsForm.get('databases')?.markAsPristine();
      this.captureDatabasesBaseline();
      this.captureSettingsBaseline();
    } finally {
      this.saveInProgress = false;
      this.cdr.markForCheck();
    }
  }

  onCancelDatabaseSection(): void {
    if (!this.isDatabasesDirty()) return;
    this.revertDatabasesFromDisk();
  }

  private revertDatabasesFromDisk(): void {
    const saved = this.config.getSettings();
    const fa = this.databaseConnections;
    while (fa.length) {
      fa.removeAt(0);
    }
    for (const c of saved.databases?.connections || []) {
      fa.push(this.createDatabaseConnectionGroup(c));
    }
    this.captureDatabasesBaseline();
    this.settingsForm.get('databases')?.markAsPristine();
    this.cdr.markForCheck();
  }

  async onCloseSettings(): Promise<void> {
    if (this.selectedTab === 'databases' && this.isDatabasesDirty()) {
      const discard = await this.confirmDialog.confirm({
        title: 'Discard database changes?',
        message: 'Database connection profiles are not saved. Close settings without saving them?',
        destructive: true,
        confirmLabel: 'Discard',
      });
      if (!discard) return;
      this.revertDatabasesFromDisk();
    } else {
      await this.saveFromFormAuto();
    }
    this.close.emit();
  }

  /**
   * Dropdown uses method name strings; persisted settings use numeric {@link HttpMethod}.
   * `?? 'GET'` is wrong for GET because enum value is `0` (nullish coalescing keeps `0`).
   */
  private normalizeDefaultHttpMethodForForm(raw: unknown): string {
    if (raw === null || raw === undefined) {
      return 'GET';
    }
    if (typeof raw === 'number') {
      const label = HttpMethod[raw as HttpMethod];
      return typeof label === 'string' ? label : 'GET';
    }
    if (typeof raw === 'string' && raw.trim()) {
      const key = raw.trim().toUpperCase() as keyof typeof HttpMethod;
      if (typeof HttpMethod[key] === 'number') {
        return key;
      }
    }
    return 'GET';
  }

  private parseDefaultHttpMethodToEnum(raw: unknown): HttpMethod {
    if (typeof raw === 'number' && HttpMethod[raw as HttpMethod] !== undefined) {
      return raw as HttpMethod;
    }
    if (typeof raw === 'string' && raw.trim()) {
      const key = raw.trim().toUpperCase() as keyof typeof HttpMethod;
      if (typeof HttpMethod[key] === 'number') {
        return HttpMethod[key] as HttpMethod;
      }
    }
    return HttpMethod.GET;
  }

  private applyDefaultHttpMethodEnum(settings: Settings): void {
    if (settings.requests) {
      settings.requests.defaultHttpMethod = this.parseDefaultHttpMethodToEnum(
        settings.requests.defaultHttpMethod,
      );
    }
  }

  get defaultHeaders(): FormArray {
    return this.settingsForm.get('headers.defaultHeaders') as FormArray;
  }

  get sslGroup(): FormGroup {
    return this.settingsForm.get('ssl') as FormGroup;
  }

  get noProxyDisplay(): string {
    const list = this.settingsForm?.get('proxy.noProxy')?.value as string[] | undefined;
    return Array.isArray(list) ? list.join(', ') : '';
  }

  onNoProxyInput(event: Event): void {
    const raw = (event.target as HTMLInputElement).value;
    const list = raw
      .split(',')
      .map((entry) => entry.trim())
      .filter((entry) => entry.length > 0);
    this.settingsForm.get('proxy.noProxy')?.setValue(list);
  }

  addHeader() {
    this.defaultHeaders.push(
      this.fb.group({
        key: [''],
        value: [''],
        enabled: [true]
      })
    );
  }

  removeHeader(index: number) {
    this.defaultHeaders.removeAt(index);
  }

  get databaseConnections(): FormArray {
    return this.settingsForm.get('databases.connections') as FormArray;
  }

  createDatabaseConnectionGroup(conn?: any): FormGroup {
    return this.fb.group({
      id: [conn?.id ?? uuidv4()],
      name: [conn?.name ?? '', Validators.required],
      type: [conn?.type ?? 'redis', Validators.required],
      host: [conn?.host ?? 'localhost'],
      port: [conn?.port ?? 6379],
      user: [conn?.user ?? ''],
      password: [conn?.password ?? ''],
      database: [conn?.database ?? ''],
      filePath: [conn?.filePath ?? ''],
      tls: [conn?.tls ?? false],
      connectTimeoutMs: [conn?.connectTimeoutMs ?? 10_000],
      commandTimeoutMs: [conn?.commandTimeoutMs ?? null],
      busyTimeoutMs: [conn?.busyTimeoutMs ?? 5000],
    });
  }

  /** Which database row shows the full editor (compact list + expandable detail). */
  expandedDbIndex: number | null = null;

  addDatabaseConnection(): void {
    this.databaseConnections.push(this.createDatabaseConnectionGroup());
    this.expandedDbIndex = this.databaseConnections.length - 1;
    this.cdr.markForCheck();
  }

  removeDatabaseConnection(index: number): void {
    this.databaseConnections.removeAt(index);
    if (this.expandedDbIndex === index) {
      this.expandedDbIndex = null;
    } else if (this.expandedDbIndex != null && index < this.expandedDbIndex) {
      this.expandedDbIndex -= 1;
    }
    this.cdr.markForCheck();
  }

  toggleDbExpand(index: number): void {
    const prev = this.expandedDbIndex;
    const closing = prev === index;
    this.expandedDbIndex = closing ? null : index;
    if (closing && this.dbTestFeedback?.index === index) {
      this.dbTestFeedback = null;
    }
    if (!closing && this.dbTestFeedback != null && this.dbTestFeedback.index !== index) {
      this.dbTestFeedback = null;
    }
    this.cdr.markForCheck();
  }

  readonly databaseTypeOptions: DropdownOption[] = [
    { label: 'Redis', value: 'redis' },
    { label: 'SQLite (file)', value: 'sqlite' },
    { label: 'PostgreSQL', value: 'postgresql' },
    { label: 'MySQL / MariaDB', value: 'mysql' },
    { label: 'SQL Server', value: 'mssql' },
  ];

  onDatabaseTypeChange(index: number, type: string): void {
    const g = this.databaseConnections.at(index);
    if (!g || g.get('type')?.value === type) return;
    const prevPort = Number(g.get('port')?.value);
    g.patchValue({ type });
    if (type === 'sqlite') {
      this.cdr.markForCheck();
      return;
    }
    const defaultPort: Record<string, number> = {
      redis: 6379,
      postgresql: 5432,
      mysql: 3306,
      mssql: 1433,
    };
    const expected = defaultPort[type];
    if (!Number.isFinite(expected)) {
      this.cdr.markForCheck();
      return;
    }
    const wrongPorts: Record<string, number[]> = {
      redis: [5432, 3306, 1433],
      postgresql: [6379, 3306, 1433],
      mysql: [6379, 5432, 1433],
      mssql: [6379, 5432, 3306],
    };
    if (!Number.isFinite(prevPort) || (wrongPorts[type] || []).includes(prevPort)) {
      g.patchValue({ port: expected });
    }
    this.cdr.markForCheck();
  }

  databaseTypeLabel(type: string | null | undefined): string {
    switch (type) {
      case 'redis':
        return 'Redis';
      case 'sqlite':
        return 'SQLite';
      case 'postgresql':
        return 'PostgreSQL';
      case 'mysql':
        return 'MySQL';
      case 'mssql':
        return 'SQL Server';
      default:
        return type ? String(type) : '—';
    }
  }

  databaseConnectionSummary(index: number): string {
    const g = this.databaseConnections.at(index);
    if (!g) return '';
    const t = g.get('type')?.value;
    if (t === 'sqlite') {
      const fp = String(g.get('filePath')?.value || '').trim();
      if (!fp) return 'No file set';
      return fp.length > 42 ? `${fp.slice(0, 40)}…` : fp;
    }
    const host = String(g.get('host')?.value || '').trim() || 'localhost';
    const port = g.get('port')?.value;
    const p = port != null && port !== '' ? `:${port}` : '';
    return `${host}${p}`;
  }

  async testDatabaseConnection(index: number) {
    this.dbTestFeedback = null;
    this.testingDbIndex = index;
    this.cdr.markForCheck();
    try {
      const api = window.awElectron;
      if (!api?.dbTestConnection) {
        this.dbTestFeedback = {
          index,
          message: 'Database test is only available in the desktop app.',
          error: true,
        };
        return;
      }
      const raw = this.databaseConnections.at(index).value;
      const conn = this.normalizeDatabaseConnectionForIpc(raw);
      const result = await this.raceDbTestIpc(() => api.dbTestConnection(conn), conn);
      const detail = this.summarizeDbTestResult(result);
      this.dbTestFeedback = {
        index,
        message: detail ? `Connected successfully. ${detail}` : 'Connected successfully.',
        error: false,
      };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Connection failed';
      this.dbTestFeedback = { index, message, error: true };
    } finally {
      this.testingDbIndex = null;
      this.cdr.markForCheck();
    }
  }

  /**
   * Never leave the UI stuck on "Testing…" if the main-process driver ignores a short
   * connect timeout (IPC would otherwise hang indefinitely).
   */
  private raceDbTestIpc<T>(ipc: () => Promise<T>, conn: DatabaseConnection): Promise<T> {
    const connectMs = Number(conn.connectTimeoutMs);
    const commandMs = Number(conn.commandTimeoutMs);
    const base = Number.isFinite(connectMs) && connectMs > 0 ? connectMs : 10_000;
    const cmdPad = Number.isFinite(commandMs) && commandMs > 0 ? commandMs : 0;
    /** Upper bound so the spinner clears even if IPC / driver never rejects (common with very low connect timeouts). */
    const budgetMs = Math.min(120_000, Math.max(800, base + cmdPad + 600));
    return new Promise<T>((resolve, reject) => {
      let settled = false;
      const timer = window.setTimeout(() => {
        if (settled) return;
        settled = true;
        reject(
          new Error(
            `Test did not finish within ${budgetMs}ms (renderer limit). The driver may be ignoring connect timeout.`,
          ),
        );
      }, budgetMs);
      ipc()
        .then((v) => {
          if (settled) return;
          settled = true;
          window.clearTimeout(timer);
          resolve(v);
        })
        .catch((e) => {
          if (settled) return;
          settled = true;
          window.clearTimeout(timer);
          reject(e);
        });
    });
  }

  /** Strip empty optional timeouts so IPC gets numbers or omitted fields. */
  private normalizeDatabaseConnectionForIpc(value: Record<string, unknown>): DatabaseConnection {
    const cmd = Number(value['commandTimeoutMs']);
    const out = { ...value } as unknown as DatabaseConnection;
    if (!Number.isFinite(cmd) || cmd <= 0) {
      delete (out as { commandTimeoutMs?: number }).commandTimeoutMs;
    } else {
      out.commandTimeoutMs = cmd;
    }
    const c = Number(value['connectTimeoutMs']);
    if (!Number.isFinite(c) || c <= 0) {
      out.connectTimeoutMs = 10_000;
    } else {
      out.connectTimeoutMs = c;
    }
    const b = Number(value['busyTimeoutMs']);
    if (!Number.isFinite(b) || b < 0) {
      out.busyTimeoutMs = 5000;
    } else {
      out.busyTimeoutMs = b;
    }
    return out;
  }

  private summarizeDbTestResult(result: unknown): string {
    if (result === 'PONG') {
      return 'Redis replied with PONG.';
    }
    if (Array.isArray(result)) {
      if (result.length === 0) {
        return 'Server returned no rows.';
      }
      return `Server returned ${result.length} row(s).`;
    }
    if (result != null && typeof result === 'object') {
      return '';
    }
    if (result === 1 || result === true) {
      return '';
    }
    const s = String(result);
    return s.length > 120 ? `${s.slice(0, 118)}…` : s;
  }

  get certificates(): FormArray {
    return this.settingsForm.get('ssl.certificates') as FormArray;
  }

  createCertificateGroup(cert?: Certificate): FormGroup {
    return this.fb.group({
      hostname: [cert?.hostname ?? '', Validators.required],
      crtFilePath: [cert?.crtFilePath ?? ''],
      keyFilePath: [cert?.keyFilePath ?? ''],
      pfxFilePath: [cert?.pfxFilePath ?? ''],
      passphrase: [cert?.passphrase ?? '']
    });
  }

  editCertificate(index: number) {
    this.editingIndex = index;
    const cert = this.certificates.at(index).value;
    this.hostnameControl.setValue(cert.hostname ?? '');
    this.passphraseControl.setValue(cert.passphrase ?? '');
    this.newCertFiles = {
      crtFilePath: cert.crtFilePath ?? '',
      keyFilePath: cert.keyFilePath ?? '',
      pfxFilePath: cert.pfxFilePath ?? ''
    };
  }

  async cancelCertificate() {
    this.editingIndex = null;
    this.hostnameControl.reset();
    this.passphraseControl.reset();
    this.newCertFiles = { crtFilePath: '', keyFilePath: '', pfxFilePath: '' };
  }

  async saveCertificate() {
    this.isLoading = true;
    try {
      const hostname = this.hostnameControl.value?.trim();
      const { crtFilePath, keyFilePath, pfxFilePath } = this.newCertFiles;

      if (!hostname) return;

      const certData: Certificate = {
        hostname,
        passphrase: this.passphraseControl.value ?? '',
        crtFilePath: crtFilePath ?? '',
        keyFilePath: keyFilePath ?? '',
        pfxFilePath: pfxFilePath ?? ''
      };

      if (this.editingIndex !== null) {
        this.certificates.at(this.editingIndex).patchValue(certData);
      } else {
        this.certificates.push(this.createCertificateGroup(certData));
      }

      this.cancelCertificate();
    } finally {
      this.isLoading = false;
      this.cdr.markForCheck();
    }
  }

  async removeCertificate(index: number) {
    this.certificates.removeAt(index);
    if (this.editingIndex === index) this.cancelCertificate();
  }

  async importCollections() {
    this.isLoading = true;
    try {
      const file = await this.fileDialogService.openFile<{ collections: Collection[] }>(['json']);
      if (!file) return;

      let payload = file.content;
      if (payload === undefined && file.rawText) {
        try {
          payload = JSON.parse(file.rawText) as { collections: Collection[] };
        } catch {
          this.showImportPopup(`Invalid JSON file`, true);
          return;
        }
      }
      if (!payload?.collections) {
        this.showImportPopup(`Config does not contain Collections`, true);
        return;
      }

      const importedCollections = payload.collections ?? [];
      const currentCollections = this.collectionService.getCollections();
      const root = currentCollections[0] || this.createEmptyRoot();

      importedCollections.forEach(c => {
        root.folders.push(...c.folders);
        root.requests.push(...c.requests);
      });

      await this.collectionService.saveCollections([root]);
      this.showImportPopup(`Imported ${importedCollections.length} collections`);
      await this.loadSettings();
    } catch (error) {
      this.showImportPopup(`Failed to import collections`, true);
    } finally {
      this.isLoading = false;
      this.cdr.markForCheck();
    }
  }

  async importPostman() {
    this.isLoading = true;
    try {
      const file = await this.fileDialogService.openFile<any>(['json']);
      if (!file) return;

      let content = file.content;
      if (content === undefined && file.rawText) {
        try {
          content = JSON.parse(file.rawText);
        } catch {
          this.showImportPopup(`Invalid Postman collection JSON`, true);
          return;
        }
      }
      if (!content) return;

      const collection = this.importService.importPostmanCollection(content);
      await this.saveImportedCollection(collection);
      this.showImportPopup(`Imported Postman Collection: ${collection.title} `);
    } catch (error) {
      this.showImportPopup(`Failed to import Postman collection`, true);
    } finally {
      this.isLoading = false;
      this.cdr.markForCheck();
    }
  }

  async importBatchFromMultipleFiles() {
    const res = await this.fileDialogService.openFiles(['json', 'yaml', 'yml', 'har']);
    if (res == null) {
      return;
    }
    if (!res.files.length) {
      this.showImportPopup('No files selected', true);
      return;
    }
    this.batchImportDialog.startPreview(res.files);
  }

  async importBatchFromFolder(options?: ReadImportFolderOptions) {
    const res = await this.fileDialogService.readImportFolder({
      extensions: ['json', 'yaml', 'yml', 'har'],
      maxFiles: 500,
      recursive: false,
      maxDepth: 0,
      ...options,
    });
    if (res == null) {
      return;
    }
    if (!res.files.length) {
      this.showImportPopup('No matching import files in that folder', true);
      return;
    }
    this.batchImportDialog.startPreview(res.files);
  }

  async importOpenApi() {
    this.isLoading = true;
    try {
      const file = await this.fileDialogService.openFile<any>(['json', 'yaml', 'yml']);
      if (!file) return;

      let content: any = file.content;
      if (content === undefined && file.rawText !== undefined) {
        const lower = file.path.toLowerCase();
        if (lower.endsWith('.json')) {
          try {
            content = JSON.parse(file.rawText);
          } catch {
            this.showImportPopup(`Invalid OpenAPI JSON`, true);
            return;
          }
        } else {
          content = file.rawText;
        }
      }
      if (content === undefined || content === null || content === '') return;

      const collection = this.importService.importOpenApi(content);
      await this.saveImportedCollection(collection);
      this.showImportPopup(`Imported OpenAPI: ${collection.title} `);
    } catch (error) {
      this.showImportPopup(`Failed to import OpenAPI file`, true);
    } finally {
      this.isLoading = false;
      this.cdr.markForCheck();
    }
  }

  private async saveImportedCollection(collection: Collection) {
    const currentCollections = this.collectionService.getCollections();
    const root = currentCollections[0] || this.createEmptyRoot();

    root.folders.push(...collection.folders);
    root.requests.push(...collection.requests);

    await this.collectionService.saveCollections([root]);
    this.collectionsExist = true;
    this.cdr.markForCheck();
  }

  private createEmptyRoot(): Collection {
    return {
      id: 'root',
      order: 0,
      title: 'Root',
      requests: [],
      folders: []
    };
  }

  async deleteAllCollections() {
    const ok = await this.confirmDialog.confirm({
      title: 'Delete all collections',
      message: 'Are you sure you want to delete all folders and requests? This cannot be undone.',
      destructive: true,
      confirmLabel: 'Delete all',
    });
    if (!ok) return;

    this.isLoading = true;
    try {
      await this.collectionService.deleteAllCollections();
      this.collectionsExist = false;
      this.showImportPopup('All collections deleted');
    } catch (error) {
      this.showImportPopup('Failed to delete collections', true);
    } finally {
      this.isLoading = false;
      this.cdr.markForCheck();
    }
  }

  async exportCollections() {
    this.isLoading = true;
    try {
      const collections = this.collectionService.getCollections();

      if (!collections || collections.length === 0) {
        this.showImportPopup(`No collections to export`, true);
        return;
      }

      await this.fileDialogService.saveFile<{ collections: Collection[] }>({
        title: 'Export Collections',
        defaultName: 'collections.json',
        content: { collections },
      });
    } catch {
      this.showImportPopup('Failed to export collections', true);
    } finally {
      this.isLoading = false;
      this.cdr.markForCheck();
    }
  }

  async exportCollectionsToFolderSingleFile() {
    this.isLoading = true;
    try {
      const collections = this.collectionService.getCollections();
      if (!collections?.length) {
        this.showImportPopup('No collections to export', true);
        return;
      }
      const dir = await this.fileDialogService.openDirectoryForExport();
      if (!dir) {
        return;
      }
      const data = JSON.stringify({ collections }, null, 2);
      const r = await this.fileDialogService.writeFilesToDirectory(dir, [
        { name: 'api-workbench-collections.json', data },
      ]);
      if (!r.ok) {
        this.showImportPopup(r.error || 'Failed to write export files', true);
        return;
      }
      this.showImportPopup(`Exported one bundle file to the selected folder`);
    } catch {
      this.showImportPopup('Failed to export to folder', true);
    } finally {
      this.isLoading = false;
      this.cdr.markForCheck();
    }
  }

  async exportCollectionsToFolderSplit() {
    this.isLoading = true;
    try {
      const collections = this.collectionService.getCollections();
      if (!collections?.length) {
        this.showImportPopup('No collections to export', true);
        return;
      }
      const dir = await this.fileDialogService.openDirectoryForExport();
      if (!dir) {
        return;
      }
      const files: Array<{ name: string; data: string }> = [];
      const used = new Set<string>();
      if (collections.length > 1) {
        for (const c of collections) {
          const name = this.uniqueExportFileName(c.title || c.id, used);
          files.push({ name, data: JSON.stringify({ collections: [c] }, null, 2) });
        }
      } else {
        const root = collections[0];
        for (const f of root.folders) {
          const col = this.folderToCollection(f);
          const name = this.uniqueExportFileName(f.title, used);
          files.push({ name, data: JSON.stringify({ collections: [col] }, null, 2) });
        }
        if (root.requests.length) {
          const requestsOnly: Collection = {
            id: root.id,
            order: root.order,
            title: root.title || 'Root',
            requests: root.requests,
            folders: [],
            auth: root.auth,
            settings: root.settings,
            script: root.script,
          };
          files.push({
            name: this.uniqueExportFileName(`${root.title || 'root'}-requests`, used),
            data: JSON.stringify({ collections: [requestsOnly] }, null, 2),
          });
        }
        if (files.length === 0) {
          this.showImportPopup('Nothing to export (no folders or top-level requests)', true);
          return;
        }
      }
      const r = await this.fileDialogService.writeFilesToDirectory(dir, files);
      if (!r.ok) {
        this.showImportPopup(r.error || 'Failed to write export files', true);
        return;
      }
      this.showImportPopup(
        `Exported ${r.written} file(s) to the selected folder`,
        false,
      );
    } catch {
      this.showImportPopup('Failed to export to folder', true);
    } finally {
      this.isLoading = false;
      this.cdr.markForCheck();
    }
  }

  private folderToCollection(f: Folder): Collection {
    return {
      id: f.id,
      order: f.order,
      title: f.title,
      requests: f.requests,
      folders: f.folders,
      auth: f.auth,
      settings: f.settings,
      script: f.script,
    };
  }

  private uniqueExportFileName(base: string, used: Set<string>): string {
    const stem0 = (base || 'collection')
      .replace(/[^a-z0-9-_]+/gi, '-')
      .replace(/^-+|-+$/g, '') || 'collection';
    const stem = stem0.slice(0, 64).toLowerCase();
    let name = `${stem}.json`;
    let n = 2;
    while (used.has(name)) {
      name = `${stem}-${n}.json`;
      n += 1;
    }
    used.add(name);
    return name;
  }

  async chooseCertFile(type: 'crt' | 'key' | 'pfx') {
    const extensions = this.fileExtensionsFor(type);
    const file = await this.fileDialogService.openFile(extensions);
    const filePath = file?.path;

    if (filePath) {
      this.newCertFiles = { ...this.newCertFiles, [`${type}FilePath`]: filePath };
      this.cdr.markForCheck();
    }
  }

  removeCertFile(type: 'crt' | 'key' | 'pfx') {
    this.newCertFiles = { ...this.newCertFiles, [`${type}FilePath`]: '' };
  }

  private fileExtensionsFor(type: string): string[] {
    switch (type) {
      case 'crt': return ['crt', 'pem'];
      case 'key': return ['key'];
      case 'pfx': return ['pfx', 'p12'];
      default: return [];
    }
  }

  private showImportPopup(
    message: string,
    failed: boolean = false,
    duration: number = 4000
  ) {
    this.importMessage = message;
    this.importFailed = failed;
    this.showPopup = true;
    this.cdr.markForCheck();

    setTimeout(() => {
      this.hideImportPopup();
    }, duration);
  }

  private hideImportPopup() {
    this.showPopup = false;
    this.importMessage = null;
    this.importFailed = false;
    this.cdr.markForCheck();
  }

  async selectTab(tab: string): Promise<void> {
    if (this.selectedTab === 'databases' && tab !== 'databases' && this.isDatabasesDirty()) {
      const discard = await this.confirmDialog.confirm({
        title: 'Unsaved database changes',
        message: 'Discard unsaved connection profile edits and leave this tab?',
        destructive: true,
        confirmLabel: 'Discard and leave',
      });
      if (!discard) return;
      this.revertDatabasesFromDisk();
    }
    this.selectedTab = tab;
    if (tab === 'databases') {
      this.captureDatabasesBaseline();
    }
    if (tab === 'data' || tab === 'logging') {
      void this.refreshStorageInfo();
    }
    if (tab !== 'databases') {
      await this.saveFromFormAuto();
    }
    this.cdr.markForCheck();
  }

  async refreshStorageInfo(): Promise<void> {
    const api = typeof window !== 'undefined' ? window.awElectron : undefined;
    if (!api?.getStorageInfo) {
      this.storageInfo = null;
      this.cdr.markForCheck();
      return;
    }
    try {
      this.storageInfo = await api.getStorageInfo();
    } catch {
      this.storageInfo = null;
    }
    this.cdr.markForCheck();
  }

  async openUserDataFolder(): Promise<void> {
    const api = window.awElectron;
    if (!api?.openUserDataDirectory) return;
    await api.openUserDataDirectory();
  }

  async copyStoragePath(value: string | null | undefined, rowKey: string): Promise<void> {
    const v = (value ?? '').trim();
    if (!v) return;
    try {
      await navigator.clipboard.writeText(v);
      this.pathCopyFeedbackKey = rowKey;
      if (this.pathCopyClearTimer) clearTimeout(this.pathCopyClearTimer);
      this.pathCopyClearTimer = setTimeout(() => {
        this.pathCopyFeedbackKey = null;
        this.pathCopyClearTimer = null;
        this.cdr.markForCheck();
      }, 1600);
      this.cdr.markForCheck();
    } catch {
      /* clipboard denied or unavailable */
    }
  }

  async chooseWorkDirectory(): Promise<void> {
    this.dataMessage = null;
    const api = window.awElectron;
    if (!api?.chooseDataDirectory) return;
    const r = await api.chooseDataDirectory();
    if (r && 'ok' in r && r.ok && 'relaunching' in r && r.relaunching) {
      this.dataMessage = 'Relaunching to apply the new work directory…';
    } else if (r && 'ok' in r && !r.ok && 'error' in r && r.error) {
      this.dataMessage = r.error;
    }
    void this.refreshStorageInfo();
    this.cdr.markForCheck();
  }

  async resetWorkDirectoryToDefault(): Promise<void> {
    this.dataMessage = null;
    const api = window.awElectron;
    if (!api?.resetDataDirectoryOverride) return;
    const r = await api.resetDataDirectoryOverride();
    if (r && 'ok' in r && r.ok && 'relaunching' in r && r.relaunching) {
      this.dataMessage = 'Relaunching to use the default data location…';
    } else if (r && 'ok' in r && !r.ok && 'error' in r && r.error) {
      this.dataMessage = r.error;
    }
    void this.refreshStorageInfo();
    this.cdr.markForCheck();
  }

  togglePassphraseVisibility() {
    this.showPassphrase = !this.showPassphrase;
  }

  getNormalizedThemeName(theme: Theme): string {
    if (theme === Theme.SYSTEM) {
      return 'System (OS)';
    }
    return theme
      .split('-')
      .map((word, index) => (index === 0 ? word : word.charAt(0).toUpperCase() + word.slice(1)))
      .join(' ');
  }

  onBackdropClick(event: MouseEvent) {
    if ((event.target as HTMLElement).classList.contains('settings-container')) {
      void this.onCloseSettings();
    }
  }

  protected readonly HttpMethod = HttpMethod;
}

