import { Injectable } from '@angular/core';
import * as yaml from 'js-yaml';
import { v4 as uuidv4 } from 'uuid';
import { Collection, Folder } from '@models/collection';
import { FileDialogResult } from '@models/file-dialog';
import { Request } from '@models/request';
import { CollectionService } from '@core/collection/collection.service';
import { ImportService } from './import.service';

export type ImportBatchFormat =
  | 'workbench'
  | 'postman'
  | 'openapi'
  | 'har'
  | 'insomnia'
  | 'unknown';

export interface BatchImportItemError {
  path: string;
  message: string;
}

export interface BatchImportResult {
  ok: number;
  failed: number;
  errors: BatchImportItemError[];
}

/** How merged collections attach to the workspace root. */
export type BatchMergeMode = 'flat' | 'folderPerFile' | 'flatWithPrefix';

export function formatBatchImportSummary(r: BatchImportResult): string {
  if (r.ok === 0 && r.failed === 0) {
    return 'No files processed';
  }
  if (r.failed === 0) {
    return `Imported ${r.ok} file(s)`;
  }
  const errHint = r.errors[0] ? ` (${r.errors[0].message})` : '';
  return `Imported ${r.ok} file(s), ${r.failed} failed${errHint}`;
}

export interface PreviewRow {
  path: string;
  basename: string;
  kind: ImportBatchFormat;
  title: string;
  warning?: string;
}

function fileBasename(p: string): string {
  const s = p.replace(/\\/g, '/');
  const i = s.lastIndexOf('/');
  return i >= 0 ? s.slice(i + 1) : s;
}

/**
 * Heuristic: Workbench, HAR, Insomnia, Postman, OpenAPI.
 */
export function detectImportFormat(
  filePath: string,
  rawText: string,
  content?: unknown,
): ImportBatchFormat {
  if (
    content &&
    typeof content === 'object' &&
    content !== null &&
    'collections' in (content as object) &&
    Array.isArray((content as { collections?: unknown }).collections)
  ) {
    return 'workbench';
  }

  const parsed: unknown =
    content !== undefined && content !== null
      ? content
      : (() => {
          try {
            return JSON.parse(rawText);
          } catch {
            return null;
          }
        })();

  if (parsed && typeof parsed === 'object' && parsed !== null) {
    const o = parsed as Record<string, unknown>;
    if (o['log'] && typeof o['log'] === 'object' && o['log'] !== null) {
      const ent = (o['log'] as { entries?: unknown })?.entries;
      if (Array.isArray(ent)) {
        return 'har';
      }
    }
    if (o['__export_format'] === 4 && Array.isArray(o['resources'])) {
      return 'insomnia';
    }
    if (o['info'] && Array.isArray(o['item'])) {
      return 'postman';
    }
    if (
      typeof o['openapi'] === 'string' ||
      typeof o['swagger'] === 'string' ||
      typeof o['swagger'] === 'number'
    ) {
      return 'openapi';
    }
  }

  const low = filePath.toLowerCase();
  if (low.endsWith('.yml') || low.endsWith('.yaml')) {
    try {
      const y = yaml.load(rawText) as Record<string, unknown> | null | undefined;
      if (y && typeof y === 'object' && (y['openapi'] || y['swagger'])) {
        return 'openapi';
      }
    } catch {
      return 'unknown';
    }
  }

  if (low.endsWith('.har')) {
    return 'har';
  }

  return 'unknown';
}

function deriveTitleFromContent(kind: ImportBatchFormat, content: unknown, basename: string): string {
  if (!content || typeof content !== 'object') {
    return basename.replace(/\.[^.]+$/, '') || basename;
  }
  const o = content as Record<string, unknown>;
  if (kind === 'postman') {
    const info = o['info'] as { name?: string } | undefined;
    if (info?.name) {
      return String(info.name);
    }
  }
  if (kind === 'openapi') {
    const info = o['info'] as { title?: string } | undefined;
    if (info?.title) {
      return String(info.title);
    }
  }
  if (kind === 'workbench') {
    const cols = o['collections'] as Collection[] | undefined;
    if (Array.isArray(cols) && cols[0]?.title) {
      return String(cols[0].title);
    }
  }
  return basename.replace(/\.[^.]+$/, '') || basename;
}

/**
 * One row per file for the pre-import review table.
 */
export function buildPreviewRows(files: FileDialogResult[]): PreviewRow[] {
  return files.map((f) => {
    const path = f.path || '';
    const raw = f.rawText ?? '';
    const kind = detectImportFormat(path, raw, f.content);
    const base = fileBasename(path) || 'file';
    const title = deriveTitleFromContent(kind, f.content, base);
    return {
      path,
      basename: base,
      kind,
      title: kind === 'unknown' ? '—' : title,
      warning: kind === 'unknown' ? 'Unknown format' : undefined,
    };
  });
}

function applyPrefixToRequestsInCollection(col: Collection, prefix: string): void {
  const walkF = (f: Folder) => {
    (f.requests || []).forEach((r) => {
      r.title = prefix + (r.title || '');
    });
    (f.folders || []).forEach(walkF);
  };
  (col.requests || []).forEach((r) => {
    r.title = prefix + (r.title || '');
  });
  (col.folders || []).forEach(walkF);
}

function wrapCollectionInFolder(col: Collection, folderTitle: string): Collection {
  const folder: Folder = {
    id: uuidv4(),
    order: 0,
    title: folderTitle,
    requests: col.requests || [],
    folders: col.folders || [],
  };
  return {
    id: col.id,
    order: col.order,
    title: col.title,
    requests: [],
    folders: [folder],
  };
}

/**
 * Merges Workbench, Postman, and OpenAPI files into the root collection in one
 * or more `saveCollections` calls (after each successful file so partial
 * progress is kept).
 */
@Injectable({ providedIn: 'root' })
export class ImportBatchService {
  constructor(
    private collectionService: CollectionService,
    private importService: ImportService,
  ) {}

  private createEmptyRoot(): Collection {
    return {
      id: 'root',
      order: 0,
      title: 'Root',
      requests: [],
      folders: [],
    };
  }

  private async mergeIntoRoot(collection: Collection): Promise<void> {
    const current = this.collectionService.getCollections();
    const root = current[0] || this.createEmptyRoot();
    root.folders.push(...collection.folders);
    root.requests.push(...collection.requests);
    await this.collectionService.saveCollections([root]);
  }

  private async importWorkbench(
    file: FileDialogResult,
    options: { mergeMode: BatchMergeMode; fileLabel: string; requestTitlePrefix?: string },
  ): Promise<void> {
    let payload = file.content as { collections?: Collection[] } | undefined;
    if (payload === undefined && file.rawText) {
      try {
        payload = JSON.parse(file.rawText) as { collections?: Collection[] };
      } catch {
        throw new Error('Invalid workbench export JSON');
      }
    }
    if (!payload?.collections?.length) {
      throw new Error('Config does not contain collections');
    }
    for (const c of payload.collections) {
      let col = c;
      if (options.requestTitlePrefix && options.mergeMode === 'flatWithPrefix') {
        applyPrefixToRequestsInCollection(col, options.requestTitlePrefix);
      } else if (options.mergeMode === 'folderPerFile') {
        col = wrapCollectionInFolder(col, col.title || options.fileLabel);
      }
      await this.mergeIntoRoot(col);
    }
  }

  private async importOpenApiFile(
    file: FileDialogResult,
    options: { mergeMode: BatchMergeMode; fileLabel: string; requestTitlePrefix?: string },
  ): Promise<void> {
    let content: any = file.content;
    if (content === undefined && file.rawText !== undefined) {
      const p = file.path.toLowerCase();
      if (p.endsWith('.json')) {
        try {
          content = JSON.parse(file.rawText);
        } catch {
          throw new Error('Invalid OpenAPI JSON');
        }
      } else {
        content = file.rawText;
      }
    }
    if (content === undefined || content === null || content === '') {
      throw new Error('Empty file');
    }
    let col = this.importService.importOpenApi(
      typeof content === 'string' ? content : JSON.stringify(content),
    );
    col = this.applyMergeToCollection(col, options);
    await this.mergeIntoRoot(col);
  }

  private async importPostmanAsync(
    file: FileDialogResult,
    options: { mergeMode: BatchMergeMode; fileLabel: string; requestTitlePrefix?: string },
  ): Promise<void> {
    let content: any = file.content;
    if (content === undefined && file.rawText) {
      try {
        content = JSON.parse(file.rawText);
      } catch {
        throw new Error('Invalid Postman collection JSON');
      }
    }
    if (!content) {
      throw new Error('No Postman content');
    }
    let col = this.importService.importPostmanCollection(JSON.stringify(content));
    col = this.applyMergeToCollection(col, options);
    await this.mergeIntoRoot(col);
  }

  private applyMergeToCollection(
    col: Collection,
    options: { mergeMode: BatchMergeMode; fileLabel: string; requestTitlePrefix?: string },
  ): Collection {
    if (options.requestTitlePrefix && options.mergeMode === 'flatWithPrefix') {
      applyPrefixToRequestsInCollection(col, options.requestTitlePrefix);
      return col;
    }
    if (options.mergeMode === 'folderPerFile') {
      return wrapCollectionInFolder(col, col.title || options.fileLabel);
    }
    return col;
  }

  private async importHarAsync(
    file: FileDialogResult,
    options: { mergeMode: BatchMergeMode; fileLabel: string; requestTitlePrefix?: string },
  ): Promise<void> {
    const raw = file.rawText ?? '';
    if (!raw.trim()) {
      throw new Error('Empty HAR file');
    }
    let col = this.importService.importHar(file.content ?? raw);
    col = this.applyMergeToCollection(col, options);
    await this.mergeIntoRoot(col);
  }

  private async importInsomniaAsync(
    file: FileDialogResult,
    options: { mergeMode: BatchMergeMode; fileLabel: string; requestTitlePrefix?: string },
  ): Promise<void> {
    const raw = file.rawText ?? '';
    if (!raw.trim()) {
      throw new Error('Empty file');
    }
    let col = this.importService.importInsomniaExport(file.content ?? JSON.parse(raw));
    col = this.applyMergeToCollection(col, options);
    await this.mergeIntoRoot(col);
  }

  private async importOne(
    file: FileDialogResult,
    kind: ImportBatchFormat,
    batchOptions: {
      mergeMode: BatchMergeMode;
      fileLabel: string;
      requestTitlePrefix?: string;
    },
  ): Promise<void> {
    if (kind === 'workbench') {
      await this.importWorkbench(file, {
        mergeMode: batchOptions.mergeMode,
        fileLabel: batchOptions.fileLabel,
        requestTitlePrefix: batchOptions.requestTitlePrefix,
      });
    } else if (kind === 'postman') {
      await this.importPostmanAsync(file, {
        mergeMode: batchOptions.mergeMode,
        fileLabel: batchOptions.fileLabel,
        requestTitlePrefix: batchOptions.requestTitlePrefix,
      });
    } else if (kind === 'openapi') {
      await this.importOpenApiFile(file, {
        mergeMode: batchOptions.mergeMode,
        fileLabel: batchOptions.fileLabel,
        requestTitlePrefix: batchOptions.requestTitlePrefix,
      });
    } else if (kind === 'har') {
      await this.importHarAsync(file, {
        mergeMode: batchOptions.mergeMode,
        fileLabel: batchOptions.fileLabel,
        requestTitlePrefix: batchOptions.requestTitlePrefix,
      });
    } else if (kind === 'insomnia') {
      await this.importInsomniaAsync(file, {
        mergeMode: batchOptions.mergeMode,
        fileLabel: batchOptions.fileLabel,
        requestTitlePrefix: batchOptions.requestTitlePrefix,
      });
    } else {
      throw new Error('Unrecognized file format');
    }
  }

  /**
   * Import a list of files (from multi-select or folder). Saves after each
   * successful file.
   */
  async runBatch(
    files: FileDialogResult[],
    options?: {
      onProgress?: (index: number, total: number) => void;
      cancel?: { current: boolean };
      mergeMode?: BatchMergeMode;
      requestTitlePrefix?: string;
    },
  ): Promise<BatchImportResult> {
    if (!files?.length) {
      return { ok: 0, failed: 0, errors: [] };
    }
    const mergeMode = options?.mergeMode ?? 'flat';
    const requestTitlePrefix = options?.requestTitlePrefix;
    const errors: BatchImportItemError[] = [];
    let ok = 0;
    let failed = 0;
    const total = files.length;
    for (let idx = 0; idx < files.length; idx++) {
      const file = files[idx];
      if (options?.cancel?.current) {
        break;
      }
      if (options?.onProgress) {
        options.onProgress(idx, total);
      }
      const path = file.path || `file ${idx + 1}`;
      const raw = file.rawText ?? '';
      const fileLabel = fileBasename(path).replace(/\.[^.]+$/, '') || `import-${idx + 1}`;
      try {
        const kind = detectImportFormat(path, raw, file.content);
        if (kind === 'unknown') {
          failed++;
          errors.push({ path, message: 'Unrecognized file format' });
          continue;
        }
        await this.importOne(file, kind, { mergeMode, fileLabel, requestTitlePrefix });
        ok++;
      } catch (e) {
        failed++;
        errors.push({ path, message: (e as Error)?.message || String(e) });
      }
    }
    if (options?.onProgress) {
      options.onProgress(total, total);
    }
    return { ok, failed, errors };
  }
}
