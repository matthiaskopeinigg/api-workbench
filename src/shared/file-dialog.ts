export interface FileDialogResult<T = any> {
  path: string;
  /** Present when the file was valid JSON (extension `.json`). */
  content?: T;
  /** Raw UTF-8 text read in the main process when the user selected the file. */
  rawText?: string;
}

export interface SaveFileOptions<T = any> {
  content: T;
  defaultName?: string;
  title?: string;
}


