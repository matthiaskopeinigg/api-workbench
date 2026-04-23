import { Component, HostListener, OnInit } from '@angular/core';
import { FileDialogResult } from '@models/file-dialog';
import { BatchImportDialogService } from '@core/import-pipeline/batch-import-dialog.service';
import { RouterOutlet } from '@angular/router';
import { ThemeService } from '@core/settings/theme.service';
import { RequestHistoryService } from '@core/http/request-history.service';

import { CollectionService } from '@core/collection/collection.service';
import { CommandSeedsService } from '@core/commands/command-seeds.service';
import { EnvironmentsService } from '@core/environments/environments.service';
import { SessionService } from '@core/session/session.service';
import { SettingsService } from '@core/settings/settings.service';
import { CommonModule } from '@angular/common';
import { TabService } from '@core/tabs/tab.service';
import { UpdateService } from '@core/platform/update.service';
import { ViewStateService } from '@core/session/view-state.service';
import { CommandPaletteComponent } from './features/workspace/shared/command-palette/command-palette.component';
import { BatchImportDialogComponent } from './features/workspace/shared/batch-import-dialog/batch-import-dialog.component';
import { RunnerDialogComponent } from './features/workspace/shared/runner-dialog/runner-dialog.component';
import { ShortcutsPanelComponent } from './features/workspace/shared/shortcuts-panel/shortcuts-panel.component';
import { RunnerDialogService, RunnerDialogRequest } from '@core/testing/runner-dialog.service';
import { TestArtifactService } from '@core/testing/test-artifact.service';
import { SampleWorkspaceSeeder } from '@core/seeding/sample-workspace.seeder';
import { LOAD_TEST_SESSION_RUNS_KEY } from '@core/testing/load-test-session.keys';
import { Subscription } from 'rxjs';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [
    RouterOutlet,
    CommonModule,
    CommandPaletteComponent,
    BatchImportDialogComponent,
    RunnerDialogComponent,
    ShortcutsPanelComponent,
  ],
  templateUrl: './app.component.html',
  styleUrl: './app.component.scss'
})
export class AppComponent implements OnInit {

  isReady = false;
  initError: string | null = null;
  runnerRequest: RunnerDialogRequest | null = null;
  private runnerSub?: Subscription;

  constructor(

    private collectionService: CollectionService,
    private environmentService: EnvironmentsService,
    private requestHistoryService: RequestHistoryService,
    private sessionService: SessionService,
    private settingsService: SettingsService,
    private tabService: TabService,
    private themeService: ThemeService,
    private updateService: UpdateService,
    private viewStateService: ViewStateService,
    private commandSeedsService: CommandSeedsService,
    private runnerDialogService: RunnerDialogService,
    private testArtifactService: TestArtifactService,
    private sampleWorkspaceSeeder: SampleWorkspaceSeeder,
    private batchImportDialog: BatchImportDialogService) { }

  async ngOnInit() {
    await this.runInit();
    this.commandSeedsService.register();
    this.runnerSub = this.runnerDialogService.open$().subscribe(req => {
      this.runnerRequest = req;
    });
  }

  closeRunnerDialog = () => this.runnerDialogService.close();

  /**
   * Disk persistence is debounced (see CollectionService / EnvironmentsService),
   * so on app shutdown we have to flush the most recent edits before the
   * renderer is torn down or the last few keystrokes would be lost.
   */
  @HostListener('document:dragover', ['$event'])
  onDocumentDragover(event: DragEvent) {
    if (event.dataTransfer?.types?.includes('Files')) {
      event.preventDefault();
    }
  }

  @HostListener('document:drop', ['$event'])
  async onDocumentDrop(event: DragEvent) {
    event.preventDefault();
    const target = event.target as HTMLElement | null;
    if (target?.closest('textarea, input, [contenteditable="true"]')) {
      return;
    }
    const dt = event.dataTransfer;
    if (!dt?.files?.length) return;
    const files = await this.filesToImportDescriptors(dt.files);
    if (!files.length) return;
    this.batchImportDialog.startPreview(files);
  }

  private async filesToImportDescriptors(fileList: FileList): Promise<FileDialogResult[]> {
    const out: FileDialogResult[] = [];
    for (let i = 0; i < fileList.length; i++) {
      const f = fileList[i];
      const name = f.name.toLowerCase();
      if (!/\.(json|ya?ml|har)$/.test(name)) continue;
      const rawText = await f.text();
      const fileWithPath = f as File & { path?: string };
      const filePath = fileWithPath.path || f.name;
      let content: unknown = undefined;
      if (name.endsWith('.json')) {
        try {
          content = JSON.parse(rawText);
        } catch {
          /* unknown JSON — batch import may still fail with a clear error */
        }
      }
      out.push({ path: filePath, rawText, content });
    }
    return out;
  }

  @HostListener('window:beforeunload')
  async onBeforeUnload(): Promise<void> {
    await Promise.all([
      this.collectionService.flushPendingSaves(),
      this.environmentService.flushPendingSaves(),
    ]);
  }

  async retryInit() {
    this.initError = null;
    this.isReady = false;
    await this.runInit();
  }

  private async runInit() {
    try {
      await Promise.all([
        this.collectionService.loadCollections(),
        this.environmentService.loadEnvironments(),
        this.requestHistoryService.loadHistory(),
        this.tabService.loadSettings(),
        this.sessionService.load('collapsedCollections'),
        this.sessionService.load('expandedCollections'),
        this.sessionService.load('expandedFolders'),
        this.sessionService.load(LOAD_TEST_SESSION_RUNS_KEY),
        this.settingsService.loadSettings(),
        this.themeService.loadTheme(),
        this.viewStateService.load(),
        this.testArtifactService.loadAll(),
      ]);

      await this.sampleWorkspaceSeeder.runIfEmptyWorkspace();

      this.isReady = true;
      this.initError = null;

      if (window.awElectron) {
        window.awElectron.appReady();
      }
    } catch (err) {
      console.error('Failed to initialize app', err);
      this.isReady = false;
      this.initError =
        err instanceof Error ? err.message : 'An unexpected error occurred while starting the app.';

      if (window.awElectron) {
        window.awElectron.appReady();
      }
    }
  }

}
