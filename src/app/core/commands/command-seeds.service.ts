import { Injectable } from '@angular/core';
import { ConfirmDialogService } from '@core/ui/confirm-dialog.service';
import { v4 as uuidv4 } from 'uuid';
import { CollectionService } from '@core/collection/collection.service';
import { CommandRegistryService } from './command-registry.service';
import { CookieService } from '@core/http/cookie.service';
import { ImportIntentsService } from '@core/import-pipeline/import-intents.service';
import { SettingsService } from '@core/settings/settings.service';
import { Theme } from '@models/settings';
import { ThemeService } from '@core/settings/theme.service';
import { TabService, TabType } from '@core/tabs/tab.service';
import { MockServerService } from '@core/mock-server/mock-server.service';
import { ShortcutsPanelService } from './shortcuts-panel.service';
import { EnvironmentsService } from '@core/environments/environments.service';
import { Collection, Folder } from '@models/collection';
import { Request } from '@models/request';
import { TestArtifactService } from '@core/testing/test-artifact.service';
import type { LoadTestArtifact } from '@models/testing/load-test';
import { DEFAULT_LOAD_CONFIG, ensureLoadTestProfiles } from '@models/testing/load-test';
import type { TestSuiteArtifact } from '@models/testing/test-suite';
import { NEW_TEST_SUITE } from '@models/testing/test-suite';
import { TestSuiteRunnerService } from '@core/testing/test-suite-runner.service';
import type { ContractTestArtifact } from '@models/testing/contract-test';
import { NEW_CONTRACT_TEST } from '@models/testing/contract-test';
import type { FlowArtifact } from '@models/testing/flow';
import { NEW_FLOW } from '@models/testing/flow';

/**
 * Seeds the command palette with a baseline set of always-available commands.
 * Feature modules can register additional commands through
 * `CommandRegistryService` at any time (e.g. per-tab actions).
 */
@Injectable({ providedIn: 'root' })
export class CommandSeedsService {
  private registered = false;

  constructor(
    private registry: CommandRegistryService,
    private themeService: ThemeService,
    private settingsService: SettingsService,
    private collectionService: CollectionService,
    private cookieService: CookieService,
    private importIntents: ImportIntentsService,
    private tabService: TabService,
    private mockServer: MockServerService,
    private shortcutsPanel: ShortcutsPanelService,
    private environmentsService: EnvironmentsService,
    private testArtifacts: TestArtifactService,
    private suiteRunner: TestSuiteRunnerService,
    private confirmDialog: ConfirmDialogService,
  ) {}

  /** Idempotent; safe to call on every boot path. */
  register(): void {
    if (this.registered) return;
    this.registered = true;

    this.registry.registerAll([
      {
        id: 'workbench.newCollection',
        label: 'New collection',
        category: 'Workspace',
        hint: 'Create an empty collection in the sidebar',
        run: () => this.collectionService.triggerCreateNewCollection(),
      },
      {
        id: 'workbench.newWebSocket',
        label: 'New WebSocket tab',
        category: 'Workspace',
        hint: 'Open a scratch WebSocket / SSE playground',
        run: () => this.tabService.openTab({
          id: `ws-${uuidv4()}`,
          title: 'WebSocket',
          type: TabType.WEBSOCKET,
        }),
      },
      {
        id: 'workbench.newSse',
        label: 'New SSE tab',
        category: 'Workspace',
        hint: 'Open a server-sent events stream viewer',
        run: () => this.tabService.openTab({
          id: `ws-${uuidv4()}`,
          title: 'SSE',
          type: TabType.WEBSOCKET,
        }),
      },
      {
        id: 'workbench.showShortcuts',
        label: 'Show keyboard shortcuts',
        category: 'Help',
        hint: 'Toggle the shortcuts reference panel',
        run: () => this.shortcutsPanel.toggle(),
      },
      {
        id: 'workbench.exportEnvTemplate',
        label: 'Export active environment as template…',
        category: 'Environment',
        hint: 'Download current variables with empty values (safe to share)',
        run: () => this.exportActiveEnvironmentTemplate(),
      },
      {
        id: 'workbench.openMockServer',
        label: 'Open Mock Server',
        category: 'Mock',
        hint: 'Open the Mock Server tab',
        run: () => this.tabService.openMockServerTab(),
      },
      {
        id: 'workbench.mockServer.start',
        label: 'Mock server: start',
        category: 'Mock',
        hint: 'Start the local mock HTTP server',
        run: () => { void this.mockServer.start(); },
      },
      {
        id: 'workbench.mockServer.stop',
        label: 'Mock server: stop',
        category: 'Mock',
        hint: 'Stop the local mock HTTP server',
        run: () => { void this.mockServer.stop(); },
      },
      {
        id: 'workbench.mockServer.restart',
        label: 'Mock server: restart',
        category: 'Mock',
        hint: 'Restart the local mock HTTP server',
        run: () => { void this.mockServer.restart(); },
      },
      {
        id: 'workbench.import.postman',
        label: 'Import Postman collection…',
        category: 'Import',
        run: () => this.importIntents.triggerPostmanImport(),
      },
      {
        id: 'workbench.import.openapi',
        label: 'Import OpenAPI definition…',
        category: 'Import',
        run: () => this.importIntents.triggerOpenApiImport(),
      },
      {
        id: 'workbench.import.curl',
        label: 'Paste cURL command…',
        category: 'Import',
        run: () => this.importIntents.triggerCurlImport(),
      },
      {
        id: 'workbench.import.batchFiles',
        label: 'Import multiple files…',
        category: 'Import',
        hint: 'Postman, OpenAPI, or API Workbench JSON in one pass',
        run: () => this.importIntents.triggerImportBatchFiles(),
      },
      {
        id: 'workbench.import.folder',
        label: 'Import from folder…',
        category: 'Import',
        hint: 'All .json, .yaml, .yml in the selected folder (not subfolders)',
        run: () => this.importIntents.triggerImportFromFolder(),
      },
      {
        id: 'workbench.import.folderRecursive',
        label: 'Import from folder (include subfolders)…',
        category: 'Import',
        hint: 'Up to 2 levels deep; skips node_modules, .git, dist',
        run: () => this.importIntents.triggerImportFromFolder({ recursive: true, maxDepth: 2 }),
      },
      {
        id: 'workbench.cookies.clear',
        label: 'Clear all cookies',
        category: 'Data',
        hint: 'Removes every cookie from the Electron jar',
        run: async () => this.cookieService.clearAllCookies(),
      },
      {
        id: 'workbench.theme.toggle',
        label: 'Toggle light/dark theme',
        category: 'Appearance',
        run: async () => {
          const current = this.themeService.getTheme();
          const darkSet = new Set<Theme>([
            Theme.DARK,
            Theme.AYU_DARK,
            Theme.DRACULA,
            Theme.MONOKAI,
            Theme.NIGHT_OWL_DARK,
            Theme.SOLARIZED_DARK,
            Theme.HIGH_CONTRAST_DARK,
            Theme.HIGH_CONTRAST_DARKLIGHT,
          ]);
          const next = darkSet.has(current) ? Theme.AYU_LIGHT : Theme.AYU_DARK;
          await this.themeService.setTheme(next);
        },
      },
      ...this.themeCommands(),
      {
        id: 'workbench.ui.toggleCompact',
        label: 'Toggle compact mode',
        category: 'Appearance',
        run: async () => {
          const settings = this.settingsService.getSettings();
          if (!settings.ui) return;
          settings.ui.compactMode = !settings.ui.compactMode;
          await this.settingsService.saveSettings(settings);
          this.themeService.applyTheme(this.themeService.getTheme());
        },
      },
      {
        id: 'workbench.window.reload',
        label: 'Reload window',
        category: 'Workspace',
        hint: 'Restart the renderer (keeps saved data)',
        run: () => window.location.reload(),
      },
      {
        id: 'workbench.new.loadTest',
        label: 'New load test',
        category: 'Testing',
        hint: 'Create a load test artifact and open it',
        run: () => this.createAndOpenLoadTest(),
      },
      {
        id: 'workbench.new.testSuite',
        label: 'New test suite',
        category: 'Testing',
        hint: 'Create an API test suite artifact and open it',
        run: () => this.createAndOpenSuite(),
      },
      {
        id: 'workbench.new.contractTest',
        label: 'New contract test',
        category: 'Testing',
        hint: 'Validate a collection against an OpenAPI spec',
        run: () => this.createAndOpenContract(),
      },
      {
        id: 'workbench.new.flow',
        label: 'New flow',
        category: 'Testing',
        hint: 'Build a request chain on a visual canvas',
        run: () => this.createAndOpenFlow(),
      },
    ]);

    const collectionsObs = this.collectionService.getCollectionsObservable?.();
    if (collectionsObs && typeof collectionsObs.subscribe === 'function') {
      collectionsObs.subscribe((collections: Collection[]) => this.syncRequestCommands(collections));
    }
    const initial = this.collectionService.getCollections?.() || [];
    if (initial.length > 0) this.syncRequestCommands(initial);

    this.testArtifacts.loadTests$().subscribe((items) => this.syncTestArtifactCommands('loadTest', items, (a) => this.tabService.openLoadTestTab(a.id, a.title)));
    this.testArtifacts.testSuites$().subscribe((items) => {
      this.syncTestArtifactCommands('testSuite', items, (a) => this.tabService.openTestSuiteTab(a.id, a.title));
      this.syncRegressionCommands(items as TestSuiteArtifact[]);
    });
    this.testArtifacts.contractTests$().subscribe((items) => this.syncTestArtifactCommands('contractTest', items, (a) => this.tabService.openContractTestTab(a.id, a.title)));
    this.testArtifacts.flows$().subscribe((items) => this.syncTestArtifactCommands('flow', items, (a) => this.tabService.openFlowTab(a.id, a.title)));
  }

  private async createAndOpenLoadTest(): Promise<void> {
    const raw: LoadTestArtifact = {
      id: uuidv4(),
      title: 'New load test',
      updatedAt: Date.now(),
      config: { ...DEFAULT_LOAD_CONFIG, targets: [] },
    };
    const artifact = ensureLoadTestProfiles(raw);
    await this.testArtifacts.create('loadTests', artifact);
    this.tabService.openLoadTestTab(artifact.id, artifact.title);
  }

  private async createAndOpenSuite(): Promise<void> {
    const artifact = NEW_TEST_SUITE(uuidv4()) as TestSuiteArtifact;
    artifact.title = 'New test suite';
    await this.testArtifacts.create('testSuites', artifact);
    this.tabService.openTestSuiteTab(artifact.id, artifact.title);
  }

  private async createAndOpenContract(): Promise<void> {
    const artifact = NEW_CONTRACT_TEST(uuidv4()) as ContractTestArtifact;
    artifact.title = 'New contract test';
    await this.testArtifacts.create('contractTests', artifact);
    this.tabService.openContractTestTab(artifact.id, artifact.title);
  }

  private async createAndOpenFlow(): Promise<void> {
    const artifact = NEW_FLOW(uuidv4()) as FlowArtifact;
    artifact.title = 'New flow';
    await this.testArtifacts.create('flows', artifact);
    this.tabService.openFlowTab(artifact.id, artifact.title);
  }

  /**
   * Mirror every saved test suite as a "run in regression mode" command.
   * The command opens the suite tab (so results are visible), flips
   * `regressionMode` on, persists, and kicks off Run All via the runner.
   */
  private syncRegressionCommands(suites: TestSuiteArtifact[]): void {
    const prefix = 'testSuite.regression.';
    this.registry.unregisterPrefix(prefix);
    if (!suites.length) return;
    this.registry.registerAll(suites.map((a) => ({
      id: `${prefix}${a.id}`,
      label: `Run in regression mode: ${a.title || '(untitled)'}`,
      category: 'Test Suites',
      hint: 'Compare responses against stored snapshot baselines',
      run: async () => {
        const fresh = this.testArtifacts.testSuites().find((s) => s.id === a.id);
        if (!fresh) return;
        fresh.regressionMode = true;
        await this.testArtifacts.update('testSuites', { ...fresh, updatedAt: Date.now() });
        this.tabService.openTestSuiteTab(fresh.id, fresh.title);
        const updated = this.testArtifacts.testSuites().find((s) => s.id === a.id);
        if (updated) void this.suiteRunner.run(updated);
      },
    })));
  }

  private syncTestArtifactCommands(
    kindLabel: 'loadTest' | 'testSuite' | 'contractTest' | 'flow',
    items: ReadonlyArray<{ id: string; title: string }>,
    open: (a: { id: string; title: string }) => void,
  ): void {
    const prefix = `${kindLabel}.open.`;
    this.registry.unregisterPrefix(prefix);
    if (!items.length) return;
    const category =
      kindLabel === 'loadTest' ? 'Load Tests' :
      kindLabel === 'testSuite' ? 'Test Suites' :
      kindLabel === 'contractTest' ? 'Contract Tests' : 'Flows';
    this.registry.registerAll(items.map((a) => ({
      id: `${prefix}${a.id}`,
      label: a.title || '(untitled)',
      category,
      hint: `Open this ${category.slice(0, -1).toLowerCase()}`,
      run: () => open(a),
    })));
  }

  private syncRequestCommands(collections: Collection[]): void {
    this.registry.unregisterPrefix('request.open.');
    const rows: Array<{ id: string; title: string; url: string; starred?: boolean; parentLabel: string }> = [];
    const walk = (folders: Folder[] = [], parentLabel: string) => {
      for (const folder of folders) {
        const label = parentLabel ? `${parentLabel} / ${folder.title}` : folder.title;
        for (const req of folder.requests || []) {
          rows.push({ id: req.id, title: req.title || req.url, url: req.url || '', starred: (req as Request).starred, parentLabel: label });
        }
        if (folder.folders?.length) walk(folder.folders, label);
      }
    };
    for (const c of collections) {
      for (const req of c.requests || []) {
        rows.push({ id: req.id, title: req.title || req.url, url: req.url || '', starred: (req as Request).starred, parentLabel: c.title });
      }
      walk(c.folders, c.title);
    }
    if (rows.length === 0) return;
    this.registry.registerAll(rows.map((row) => ({
      id: `request.open.${row.id}`,
      label: row.title || '(untitled request)',
      category: row.starred ? 'Starred' : 'Requests',
      hint: row.parentLabel + (row.url ? ` — ${row.url}` : ''),
      keywords: [row.url, row.parentLabel].filter(Boolean),
      weight: row.starred ? 10 : 0,
      run: () => {
        this.tabService.openTab({
          id: row.id,
          title: row.title,
          type: TabType.REQUEST,
        });
      },
    })));
  }

  private async exportActiveEnvironmentTemplate(): Promise<void> {
    const env = this.environmentsService.getActiveContext?.();
    if (!env) {
      const all = this.environmentsService.getEnvironments?.() || [];
      if (all.length === 0) {
        await this.confirmDialog.alert('No environment available to export.', 'Export');
        return;
      }
      await this.downloadEnvTemplate(all[0]);
      return;
    }
    await this.downloadEnvTemplate(env);
  }

  private async downloadEnvTemplate(env: { id: string; title?: string; variables?: Array<{ key?: string; value?: string; disabled?: boolean }> }): Promise<void> {
    const template = {
      id: env.id,
      title: env.title || 'Exported template',
      exportedAt: new Date().toISOString(),
      isTemplate: true,
      variables: (env.variables || []).map((v) => ({
        key: v.key || '',
        value: '',
        disabled: !!v.disabled,
      })),
    };
    const json = JSON.stringify(template, null, 2);
    const api = typeof window !== 'undefined' ? (window as any).awElectron : null;
    const defaultName = `${(env.title || 'environment').replace(/[^a-z0-9._-]+/gi, '_')}.template.json`;
    if (api?.saveFileDialog) {
      try {
        await api.saveFileDialog({ defaultName, data: json });
        return;
      } catch (err) {
        console.error('Failed to save environment template', err);
      }
    }
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = defaultName;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }

  private themeCommands() {
    const themes: Array<{ theme: Theme; label: string }> = [
      { theme: Theme.AYU_LIGHT, label: 'Ayu Light' },
      { theme: Theme.AYU_DARK, label: 'Ayu Dark' },
      { theme: Theme.DRACULA, label: 'Dracula' },
      { theme: Theme.MONOKAI, label: 'Monokai' },
      { theme: Theme.NIGHT_OWL_DARK, label: 'Night Owl (dark)' },
      { theme: Theme.SOLARIZED_LIGHT, label: 'Solarized Light' },
      { theme: Theme.SOLARIZED_DARK, label: 'Solarized Dark' },
    ];
    return themes.map(({ theme, label }) => ({
      id: `workbench.theme.${theme}`,
      label: `Theme: ${label}`,
      category: 'Appearance',
      run: async () => this.themeService.setTheme(theme),
    }));
  }
}
