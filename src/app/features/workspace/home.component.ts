import { ChangeDetectionStrategy, ChangeDetectorRef, Component, OnDestroy, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Subject, takeUntil } from 'rxjs';
import { TabComponent } from './tab/tab.component';
import { CollectionService } from '@core/collection.service';
import { FileDialogService } from '@core/file-dialog.service';
import { ImportIntentsService } from '@core/import-intents.service';
import { BatchImportDialogService } from '@core/batch-import-dialog.service';
import { ImportService } from '@core/import.service';
import type { ReadImportFolderOptions } from '@models/file-dialog';
import { Collection } from '@models/collection';
import { v4 as uuidv4 } from 'uuid';
import { SidebarComponent } from './sidebar/sidebar.component';
import { TitlebarComponent } from './titlebar/titlebar.component';

type ToastTone = 'success' | 'error';

interface LandingToast {
  message: string;
  tone: ToastTone;
}

@Component({
  selector: 'app-home',
  imports: [
    TitlebarComponent,
    SidebarComponent,
    CommonModule,
    FormsModule,
    TabComponent,
  ],
  templateUrl: './home.component.html',
  styleUrl: './home.component.scss',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class HomeComponent implements OnInit, OnDestroy {

  secondaryToggled = false;
  tabSize: number = 0;

  isImporting = false;
  toast: LandingToast | null = null;
  private toastTimer: ReturnType<typeof setTimeout> | null = null;

  isCurlModalOpen = false;
  curlInput = '';

  private readonly destroy$ = new Subject<void>();

  constructor(
    private collectionService: CollectionService,
    private importService: ImportService,
    private batchImportDialog: BatchImportDialogService,
    private fileDialogService: FileDialogService,
    private importIntents: ImportIntentsService,
    private cdr: ChangeDetectorRef,
  ) { }

  ngOnInit(): void {
    this.importIntents.postman$().pipe(takeUntil(this.destroy$)).subscribe(() => this.importPostman());
    this.importIntents.openApi$().pipe(takeUntil(this.destroy$)).subscribe(() => this.importOpenApi());
    this.importIntents.curl$().pipe(takeUntil(this.destroy$)).subscribe(() => this.openCurlModal());
    this.importIntents.importBatchFiles$()
      .pipe(takeUntil(this.destroy$))
      .subscribe(() => { void this.importManyFilesFromPicker(); });
    this.importIntents.importFromFolder$()
      .pipe(takeUntil(this.destroy$))
      .subscribe((opts) => { void this.importFromFolderWithOptions(opts); });
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  createCollection() {
    this.collectionService.triggerCreateNewCollection();
  }

  async importPostman(): Promise<void> {
    await this.runImport(
      ['json'],
      (raw, rawText) => this.importService.importPostmanCollection(raw ?? rawText),
      'Postman collection',
    );
  }

  async importOpenApi(): Promise<void> {
    await this.runImport(
      ['json', 'yaml', 'yml'],
      (raw, rawText, path) => {
        if (raw !== undefined && raw !== null) {
          return this.importService.importOpenApi(raw);
        }
        if (path.toLowerCase().endsWith('.json')) {
          return this.importService.importOpenApi(JSON.parse(rawText));
        }
        return this.importService.importOpenApi(rawText);
      },
      'OpenAPI definition',
    );
  }

  /**
   * Multi-select: opens the batch import review dialog (Postman, OpenAPI,
   * Workbench, HAR, Insomnia, YAML).
   */
  async importManyFilesFromPicker(): Promise<void> {
    const res = await this.fileDialogService.openFiles(['json', 'yaml', 'yml', 'har']);
    if (res == null) return;
    if (!res.files.length) {
      this.showToast('No files selected', 'error');
      return;
    }
    this.batchImportDialog.startPreview(res.files);
  }

  /**
   * Folder import. `options` from the command palette can enable recursion.
   */
  async importFromFolderWithOptions(options?: ReadImportFolderOptions): Promise<void> {
    const res = await this.fileDialogService.readImportFolder({
      extensions: ['json', 'yaml', 'yml', 'har'],
      maxFiles: 500,
      recursive: false,
      maxDepth: 0,
      ...options,
    });
    if (res == null) return;
    if (!res.files.length) {
      this.showToast('No matching import files in that folder', 'error');
      return;
    }
    this.batchImportDialog.startPreview(res.files);
  }

  private async runImport(
    extensions: string[],
    build: (content: any, rawText: string, path: string) => Collection,
    label: string,
  ): Promise<void> {
    if (this.isImporting) return;
    this.isImporting = true;
    this.cdr.markForCheck();

    try {
      const file = await this.fileDialogService.openFile<any>(extensions);
      if (!file) return;

      const rawText = file.rawText ?? '';
      let content = file.content;
      if (content === undefined && rawText) {
        try {
          content = JSON.parse(rawText);
        } catch {
          content = undefined;
        }
      }

      const collection = build(content, rawText, file.path || '');
      await this.saveImportedCollection(collection);
      this.showToast(`Imported ${label}: ${collection.title}`, 'success');
    } catch (err) {
      console.error(`Failed to import ${label}`, err);
      this.showToast(`Could not import ${label}`, 'error');
    } finally {
      this.isImporting = false;
      this.cdr.markForCheck();
    }
  }

  openCurlModal() {
    this.isCurlModalOpen = true;
    this.curlInput = '';
    this.cdr.markForCheck();
  }

  closeCurlModal() {
    this.isCurlModalOpen = false;
    this.cdr.markForCheck();
  }

  async submitCurlImport() {
    const input = (this.curlInput || '').trim();
    if (!input) {
      this.showToast('Paste a cURL command first', 'error');
      return;
    }
    try {
      const request = this.importService.importCurl(input);
      const collection: Collection = {
        id: uuidv4(),
        order: 0,
        title: `cURL: ${request.title || 'Imported'}`,
        requests: [request],
        folders: [],
      };
      await this.saveImportedCollection(collection);
      this.showToast(`Imported cURL: ${request.url || 'request'}`, 'success');
      this.closeCurlModal();
    } catch (err) {
      console.error('Failed to import cURL', err);
      this.showToast('Could not parse that cURL command', 'error');
    }
  }

  private async saveImportedCollection(collection: Collection): Promise<void> {
    const current = this.collectionService.getCollections();
    const root: Collection = current[0] ?? {
      id: 'root',
      order: 0,
      title: 'Root',
      requests: [],
      folders: [],
    };

    root.folders.push(...collection.folders);
    root.requests.push(...collection.requests);
    await this.collectionService.saveCollections([root]);
  }

  private showToast(message: string, tone: ToastTone): void {
    this.toast = { message, tone };
    if (this.toastTimer) clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => {
      this.toast = null;
      this.cdr.markForCheck();
    }, 3200);
    this.cdr.markForCheck();
  }
}
