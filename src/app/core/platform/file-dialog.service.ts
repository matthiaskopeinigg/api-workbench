import { Injectable } from '@angular/core';
import {
  FileDialogResult,
  OpenFilesDialogResult,
  ReadImportFolderOptions,
  SaveFileOptions,
  WriteFilesToDirectoryResult,
} from '@models/file-dialog';

@Injectable({
  providedIn: 'root',
})
export class FileDialogService {

  async openFile<T = any>(extensions: string[] = []): Promise<FileDialogResult<T> | null> {
    try {
      return await window.awElectron.openFileDialog(extensions);
    } catch (err) {
      console.error('Failed to open file dialog:', err);
      return null;
    }
  }

  /**
   * Multi-file picker (Postman, OpenAPI, Workbench export JSON, YAML).
   */
  async openFiles<T = unknown>(extensions: string[] = []): Promise<OpenFilesDialogResult | null> {
    try {
      return await window.awElectron.openFilesDialog<T>(extensions);
    } catch (err) {
      console.error('Failed to open files dialog:', err);
      return null;
    }
  }

  /**
   * Choose a directory and read all matching import files.
   */
  async readImportFolder(
    options?: ReadImportFolderOptions,
  ): Promise<OpenFilesDialogResult | null> {
    try {
      return await window.awElectron.readImportFolder(options);
    } catch (err) {
      console.error('Failed to read import folder:', err);
      return null;
    }
  }

  async openDirectoryForExport(): Promise<string | null> {
    try {
      return await window.awElectron.openDirectoryDialog();
    } catch (err) {
      console.error('Failed to open directory dialog:', err);
      return null;
    }
  }

  /**
   * Write one or more UTF-8 text files into an existing or creatable directory.
   */
  async writeFilesToDirectory(
    dir: string,
    files: Array<{ name: string; data: string }>,
  ): Promise<WriteFilesToDirectoryResult> {
    try {
      return await window.awElectron.writeFilesToDirectory({ dir, files });
    } catch (err) {
      console.error('writeFilesToDirectory', err);
      return {
        ok: false,
        written: 0,
        error: err instanceof Error ? err.message : 'Write failed',
      };
    }
  }

  async saveFile<T = any>(options: SaveFileOptions<T>): Promise<string | null> {
    try {
      return await window.awElectron.saveFileDialog<T>(options);
    } catch (err) {
      console.error('Failed to save file:', err);
      return null;
    }
  }

}


