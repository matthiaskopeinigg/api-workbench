export interface FileDialogResult<T = any> {
  path: string;
  /** Present when the file was valid JSON (extension `.json`). */
  content?: T;
  /** Raw UTF-8 text read in the main process when the user selected the file. */
  rawText?: string;
}

/** Result of multi-select or folder import. */
export interface OpenFilesDialogResult {
  files: FileDialogResult[];
}

/** Options for reading every matching file under a chosen directory. */
export interface ReadImportFolderOptions {
  /** File extensions without dot, e.g. `['json','yaml','yml']`. */
  extensions?: string[];
  maxFiles?: number;
  /** When true, walk into subfolders up to `maxDepth`. */
  recursive?: boolean;
  /** How deep to recurse: `0` = only the selected folder. Default `2`. */
  maxDepth?: number;
  /** Directory names to skip (default node_modules, .git, dist, build, .next). */
  ignoreDirNames?: string[];
}

export interface WriteFilesToDirectoryResult {
  ok: boolean;
  written: number;
  error?: string;
}

export interface SaveFileOptions<T = any> {
  content: T;
  defaultName?: string;
  title?: string;
}


