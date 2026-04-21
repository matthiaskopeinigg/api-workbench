import { Injectable } from '@angular/core';
import { FileDialogResult, SaveFileOptions } from '@models/file-dialog';

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

  async saveFile<T = any>(options: SaveFileOptions<T>): Promise<string | null> {
    try {
      return await window.awElectron.saveFileDialog<T>(options);
    } catch (err) {
      console.error('Failed to save file:', err);
      return null;
    }
  }

}


