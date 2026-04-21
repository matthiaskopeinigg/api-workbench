import { ChangeDetectionStrategy, ChangeDetectorRef, Component, EventEmitter, OnDestroy, OnInit, Output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormArray, FormBuilder, FormGroup, ReactiveFormsModule, Validators, FormControl } from '@angular/forms';
import { Subscription } from 'rxjs';
import { debounceTime } from 'rxjs/operators';
import { Certificate, Settings, Theme } from '@models/settings';
import { HttpMethod } from '@models/request';
import { SettingsService } from '@core/settings.service';

import { ThemeService } from '@core/theme.service';
import { FileDialogService } from '@core/file-dialog.service';
import { CollectionService } from '@core/collection.service';
import { ImportService } from '@core/import.service';
import { UpdateService } from '@core/update.service';
import { Collection } from '@models/collection';
import type { UpdaterStatus } from '@models/electron';
import { DropdownComponent, DropdownOption } from '../../shared/dropdown/dropdown.component';

@Component({
  selector: 'app-settings',
  imports: [CommonModule, ReactiveFormsModule, DropdownComponent],
  templateUrl: './settings.component.html',
  styleUrls: ['./settings.component.scss'],
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SettingsComponent implements OnInit, OnDestroy {

  @Output() close = new EventEmitter<void>();

  updaterStatus: UpdaterStatus | null = null;
  private updaterSub?: Subscription;

  settingsForm!: FormGroup;
  themes: Theme[] = [Theme.SYSTEM, ...(Object.values(Theme).filter((t) => t !== Theme.SYSTEM) as Theme[])];
  httpMethods = Object.keys(HttpMethod).filter(k => isNaN(Number(k)));
  httpMethodOptions: DropdownOption[] = this.httpMethods.map(m => ({ label: m, value: m }));

  folderClickBehaviorOptions: DropdownOption[] = [
    { label: 'Open as Tab & Expand', value: 'both' },
    { label: 'Open as Tab Only', value: 'open' },
    { label: 'Expand Only', value: 'expand' }
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
        { id: 'requests', label: 'Requests', icon: 'M2 21l21-9L2 3v7l15 2-15 2z' },
        { id: 'retries', label: 'Retries', icon: 'M17.65 6.35A8 8 0 1 0 19.73 14h-2.07A6 6 0 1 1 12 6c1.66 0 3.14.69 4.22 1.78L13 11h7V4z' },
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

  importMessage: string | null = null;
  showPopup = false;
  importFailed = false;
  isLoading = false;

  constructor(
    private fb: FormBuilder,
    private config: SettingsService,
    private themeService: ThemeService,

    private fileDialogService: FileDialogService,
    private collectionService: CollectionService,

    private importService: ImportService,
    private updateService: UpdateService,
    private cdr: ChangeDetectorRef
  ) { }

  async ngOnInit() {
    await this.loadSettings();
    await this.subscribeToChanges();
    this.updaterSub = this.updateService.statusStream.subscribe((status) => {
      this.updaterStatus = status;
      this.cdr.markForCheck();
    });
  }

  ngOnDestroy(): void {
    this.updaterSub?.unsubscribe();
  }

  checkForUpdates(): void {
    void this.updateService.checkForUpdates();
  }

  downloadUpdate(): void {
    void this.updateService.downloadUpdate();
  }

  installUpdate(): void {
    this.updateService.installUpdate();
  }

  get updateStatusMessage(): string {
    const s = this.updaterStatus;
    if (!s) return 'Checking\u2026';
    if (!s.supported) {
      return s.info?.reason ?? 'Auto-update is only available in packaged builds.';
    }
    switch (s.state) {
      case 'idle': return `You are running version ${s.currentVersion}.`;
      case 'checking': return 'Checking for updates\u2026';
      case 'not-available': return `You\u2019re on the latest version (${s.currentVersion}).`;
      case 'available': return `Version ${s.info?.version ?? ''} is available.`;
      case 'downloading': {
        const p = s.info?.percent ?? 0;
        return `Downloading update\u2026 ${p}%`;
      }
      case 'downloaded': return `Version ${s.info?.version ?? ''} is ready to install.`;
      case 'error': return `Couldn\u2019t check for updates. Please try again later.`;
      case 'disabled': return s.info?.reason ?? 'Auto-update is disabled.';
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
        defaultHttpMethod: [settings?.requests?.defaultHttpMethod ?? 'GET'],
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
    });

    const collections = this.collectionService.getCollections();
    this.collectionsExist = collections.length > 0;

    await this.themeService.setTheme(this.settingsForm.get('ui.theme')?.value, false);
    this.cdr.markForCheck();
  }

  private async subscribeToChanges() {
    this.settingsForm.get('ui.theme')?.valueChanges.subscribe(async (theme: Theme) => {
      await this.themeService.setTheme(theme, false);
    });

    this.settingsForm.valueChanges
      .pipe(debounceTime(300))
      .subscribe(value => {
        const settings = JSON.parse(JSON.stringify(value));

        if (settings.headers?.defaultHeaders) {
          settings.headers.defaultHeaders = settings.headers.defaultHeaders.filter((h: any) => h.key?.trim());
        }

        this.config.saveSettings(settings as Settings);
      });
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
    if (!confirm('Are you sure you want to delete all folders and requests? This cannot be undone.')) {
      return;
    }

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

  selectTab(tab: string) {
    this.selectedTab = tab;
  }

  closeSettings() {
    this.close.emit();
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
      this.closeSettings();
    }
  }

  protected readonly HttpMethod = HttpMethod;
}

