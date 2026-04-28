import { Component, inject, signal, Input, OnInit, computed, OnChanges, SimpleChanges } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RegressionTestingService } from './regression.service';
import { FlowBrowserComponent } from './components/flow-browser/flow-browser.component';
import { FlowTreeComponent } from './components/flow-tree/flow-tree.component';
import { FlowNodeEditorComponent } from './components/node-editor/node-editor.component';
import { ReleasePlannerComponent } from './components/release-planner/release-planner.component';
import { StepType, FlowNode, FlowStep, FlowFolder } from './models/flow.model';
import { TabItem } from '@core/tabs/tab.service';

export interface ModeBreakdown {
  mode: string;
  label: string;
  count: number;
  colorVar: string;
}

export interface QuotaRow {
  id: string;
  label: string;
  used: number;
  limit: number;
  mode: string;
}

export interface DashboardSummary {
  totalTests: number;
  successRate: number;
  avgDurationMs: number;
  activeWorkspaces: number;
  modes: ModeBreakdown[];
  liveSessionsUsed: number;
  liveSessionsLimit: number;
  quotas: QuotaRow[];
}

@Component({
  selector: 'app-regression',
  standalone: true,
  imports: [CommonModule, FormsModule, FlowBrowserComponent, FlowTreeComponent, FlowNodeEditorComponent, ReleasePlannerComponent],
  templateUrl: './regression.component.html',
  styleUrl: './regression.component.scss',
  host: {
    'class': 'aw-regression-host',
    'style': 'display: block; height: 100%; width: 100%; overflow: hidden;'
  }
})
export class RegressionComponent implements OnInit, OnChanges {
  @Input() tab?: TabItem;
  private readonly currentTabId = signal<string | null>(null);

  public readonly svc = inject(RegressionTestingService);

  // ── View state ──
  readonly view = signal<'dashboard' | 'editor' | 'run-details'>('dashboard');
  readonly activeTab = signal<'flows' | 'runs'>('flows');
  readonly showCreateProjectDialog = signal(false);
  readonly showCreateFlowDialog = signal(false);
  readonly showCreateGroupDialog = signal(false);
  readonly showCreateRunDialog = signal(false);
  readonly showDeleteConfirm = signal(false);
  readonly showAddNodeDialog = signal(false);
  readonly addNodeParentId = signal<string | null>(null);
  readonly deleteTitle = signal('');
  readonly deleteMessage = signal('');
  private pendingDeleteAction: (() => void) | null = null;

  readonly newProjectName = signal('');
  readonly newFlowName = signal('');
  readonly newGroupName = signal('');
  readonly newRunTag = signal('');
  readonly newRunDesc = signal('');
  readonly selectedProjectId = signal<string | null>(null);
  readonly selectedFlowId = signal<string | null>(null);
  readonly selectedNodeId = signal<string | null>(null);
  readonly selectedRunId = signal<string | null>(null);
  readonly createFlowParentGroupId = signal<string | null>(null);
  readonly createGroupParentId = signal<string | null>(null);
  readonly manualInputValue = signal('');
  readonly showLogPanel = signal(true);

  readonly selectedProject = computed(() => {
    const id = this.selectedProjectId();
    return this.svc.projects().find(p => p.id === id) ?? null;
  });

  readonly selectedFlow = computed(() => {
    const id = this.selectedFlowId();
    return this.svc.allFlows().find(f => f.id === id) ?? null;
  });

  readonly selectedNode = computed(() => {
    const flow = this.selectedFlow();
    const nodeId = this.selectedNodeId();
    if (!flow || !nodeId) return null;
    return this.svc.findNodeById(flow.nodes, nodeId);
  });
  readonly selectedRun = computed(() => {
    const id = this.selectedRunId();
    return this.svc.runs().find(r => r.id === id) ?? null;
  });
  readonly stats = this.svc.stats;
  readonly projects = this.svc.projects;
  readonly runs = this.svc.runs;
  readonly allFlows = this.svc.allFlows;
  readonly executionLogs = this.svc.executionLogs;

  readonly isProjectScoped = computed(() => !!this.currentTabId()?.startsWith('reg:p:'));
  readonly isFlowScoped = computed(() => !!this.currentTabId()?.startsWith('reg:f:'));
  readonly isRunScoped = computed(() => !!this.currentTabId()?.startsWith('reg:r:'));

  // ── Dashboard Data ──
  readonly summary = computed<DashboardSummary>(() => {
    const run = this.selectedRun();
    if (run) {
      const total = run.results.length;
      const passed = run.results.filter(r => r.status === 'passed').length;
      const successRate = total > 0 ? (passed / total) * 100 : 0;
      
      return {
        totalTests: total,
        successRate: Math.round(successRate * 10) / 10,
        avgDurationMs: Math.round(run.results.reduce((acc, r) => acc + r.durationMs, 0) / (total || 1)),
        activeWorkspaces: 1,
        modes: [
          { mode: 'app', label: 'App', count: total, colorVar: 'var(--aw-status-info)' },
        ],
        liveSessionsUsed: 0,
        liveSessionsLimit: 0,
        quotas: []
      };
    }

    return {
      totalTests: 1284,
      successRate: 98.4,
      avgDurationMs: 342,
      activeWorkspaces: 12,
      modes: [
        { mode: 'app', label: 'App', count: 210, colorVar: 'var(--aw-status-info)' },
        { mode: 'crossBrowser', label: 'Cross Browser', count: 540, colorVar: 'var(--aw-status-warning)' },
        { mode: 'load', label: 'Load', count: 222, colorVar: 'var(--aw-status-success)' },
      ],
      liveSessionsUsed: 1,
      liveSessionsLimit: 2,
      quotas: []
    };
  });

  readonly userFilter = signal('All users');
  readonly typeFilter = signal('All types');
  readonly yearFilter = signal('2026');

  ngOnInit(): void {
    this.initFromTab();
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['tab'] && !changes['tab'].firstChange) {
      this.initFromTab();
    }
  }

  private initFromTab(): void {
    if (!this.tab) return;
    const id = this.tab.id;
    this.currentTabId.set(id);

    if (id === 'testing:regression' || id === 'reg:new-release') {
      this.view.set('dashboard');
      this.selectedProjectId.set(null);
      this.selectedFlowId.set(null);
      if (id === 'reg:new-release') {
        this.showCreateRunDialog.set(true);
      }
    } else if (id.startsWith('reg:p:')) {
      const projectId = id.replace('reg:p:', '');
      this.view.set('dashboard');
      this.selectedProjectId.set(projectId);
      this.selectedFlowId.set(null);
    } else if (id.startsWith('reg:f:')) {
      const flowId = id.replace('reg:f:', '');
      this.view.set('editor');
      this.selectedFlowId.set(flowId);
      
      // Auto-select first node
      const flow = this.svc.allFlows().find(f => f.id === flowId);
      if (flow && flow.nodes.length > 0) {
        this.selectedNodeId.set(flow.nodes[0].id);
      }
    } else if (id.startsWith('reg:r:')) {
      const runId = id.replace('reg:r:', '');
      this.view.set('dashboard');
      this.activeTab.set('flows'); // We want to see flows of this run
      this.selectedRunId.set(runId);
    }
  }

  pct(used: number, limit: number): number {
    if (!limit) return 0;
    return Math.min(100, Math.round((used / limit) * 100));
  }

  sessionsGauge(summary: DashboardSummary): number {
    return this.pct(summary.liveSessionsUsed, summary.liveSessionsLimit);
  }

  mockInstall(name: string): void {
    window.alert(`${name}: install is not wired in this app.`);
  }

  // ── Project actions ──

  openCreateProjectDialog(): void {
    this.newProjectName.set('');
    this.showCreateProjectDialog.set(true);
  }

  createProject(): void {
    const name = this.newProjectName().trim();
    if (!name) return;
    const p = this.svc.createProject(name);
    this.showCreateProjectDialog.set(false);
    this.selectProject(p.id);
  }

  selectProject(projectId: string | null): void {
    this.selectedProjectId.set(projectId);
  }

  deleteProject(projectId: string): void {
    const name = this.projects().find(p => p.id === projectId)?.name || 'this project';
    this.confirmDelete('Delete Project', `Are you sure you want to delete "${name}" and all its flows?`, () => {
      this.svc.deleteProject(projectId);
    });
  }

  // ── Flow actions ──

  openCreateFlowDialog(projectId: string, parentGroupId: string | null = null): void {
    this.newFlowName.set('');
    this.createFlowParentGroupId.set(parentGroupId);
    this.showCreateFlowDialog.set(true);
    if (projectId) this.selectedProjectId.set(projectId);
  }

  createFlow(): void {
    const name = this.newFlowName().trim();
    const projectId = this.selectedProjectId();
    if (!name || !projectId) return;
    const flow = this.svc.createFlow(projectId, this.createFlowParentGroupId(), name);
    this.showCreateFlowDialog.set(false);
    this.svc.openFlowTab(flow.id, flow.name);
  }

  openCreateGroupDialog(projectId: string, parentId: string | null = null): void {
    this.newGroupName.set('');
    this.createGroupParentId.set(parentId);
    this.showCreateGroupDialog.set(true);
    if (projectId) this.selectedProjectId.set(projectId);
  }

  createGroup(): void {
    const name = this.newGroupName().trim();
    const projectId = this.selectedProjectId();
    if (!name || !projectId) return;
    this.svc.createFlowGroup(projectId, this.createGroupParentId(), name);
    this.showCreateGroupDialog.set(false);
  }

  selectFlow(flowId: string): void {
    const flow = this.svc.allFlows().find(f => f.id === flowId);
    if (flow) {
      this.svc.openFlowTab(flow.id, flow.name);
    }
  }

  deleteFlow(flowId: string): void {
    this.confirmDelete('Delete Flow', 'Are you sure you want to delete this flow? This action cannot be undone.', () => {
      this.svc.deleteFlow(flowId);
    });
  }

  confirmDelete(title: string, message: string, action: () => void): void {
    this.deleteTitle.set(title);
    this.deleteMessage.set(message);
    this.pendingDeleteAction = action;
    this.showDeleteConfirm.set(true);
  }

  executeDelete(): void {
    if (this.pendingDeleteAction) {
      this.pendingDeleteAction();
    }
    this.closeDeleteConfirm();
  }

  closeDeleteConfirm(): void {
    this.showDeleteConfirm.set(false);
    this.pendingDeleteAction = null;
  }

  submitManualInput(): void {
    const val = this.manualInputValue();
    const req = this.svc.manualInputRequest();
    if (req) {
      req.resolve(val);
      this.svc.manualInputRequest.set(null);
      this.manualInputValue.set('');
    }
  }

  cancelManualInput(): void {
    const req = this.svc.manualInputRequest();
    if (req) {
      req.reject(new Error('User cancelled manual input'));
      this.svc.manualInputRequest.set(null);
      this.manualInputValue.set('');
    }
  }

  backToDashboard(): void {
    this.view.set('dashboard');
    this.selectedFlowId.set(null);
    this.selectedNodeId.set(null);
    this.selectedRunId.set(null);
  }

  toggleFlowGroup(projectId: string, groupId: string): void {
    this.svc.toggleFlowGroup(projectId, groupId);
  }

  deleteFlowGroup(projectId: string, groupId: string): void {
    this.confirmDelete('Delete Folder', 'Are you sure you want to delete this folder and all its flows?', () => {
      this.svc.deleteFlowGroup(projectId, groupId);
    });
  }

  onNodeSelected(nodeId: string): void {
    this.selectedNodeId.set(nodeId);
  }

  openCreateRunDialog(): void {
    this.newRunTag.set(`v1.${this.runs().length + 1}.0`);
    this.newRunDesc.set('');
    this.showCreateRunDialog.set(true);
  }

  onPlanRelease(event: { versionTag: string, description: string, flowIds: string[], settings: any }): void {
    const run = this.svc.createRun(event.versionTag, event.flowIds, event.description);
    (run as any).settings = event.settings;
    this.showCreateRunDialog.set(false);
    this.selectedRunId.set(run.id);
    this.view.set('run-details');
  }

  selectRun(id: string): void {
    this.selectedRunId.set(id);
    this.view.set('run-details');
  }

  deleteRun(id: string): void {
    this.confirmDelete('Delete Test Run', 'Are you sure you want to remove this run from history?', () => {
      this.svc.deleteRun(id);
    });
  }

  executeRun(id: string): void {
    this.svc.executeRun(id);
  }

  rerunFailed(id: string): void {
    const run = this.svc.runs().find(r => r.id === id);
    if (!run) return;
    const failedFlowIds = run.results.filter(r => r.status === 'failed').map(r => r.flowId);
    this.svc.executeRun(id, { flowIds: failedFlowIds });
  }

  hasFailures(run: any): boolean {
    return run.results.some((r: any) => r.status === 'failed');
  }

  getResult(run: any, flowId: string) {
    return run.results.find((r: any) => r.flowId === flowId);
  }

  getFlowName(flowId: string): string {
    return this.svc.allFlows().find(f => f.id === flowId)?.name || 'Unknown Flow';
  }

  countByStatus(results: any[], status: string): number {
    return results.filter(r => r.status === status).length;
  }

  // ── Node Actions ──

  openAddNodeDialog(parentId: string | null = null): void {
    this.addNodeParentId.set(parentId);
    this.showAddNodeDialog.set(true);
  }

  addFolder(name: string): void {
    const flowId = this.selectedFlow()?.id;
    let projectId = this.selectedProjectId();
    if (flowId && !projectId) {
      projectId = this.svc.findProjectIdByFlowId(flowId);
    }
    if (flowId && projectId) {
      this.svc.addFolder(projectId, flowId, this.addNodeParentId(), name);
      this.showAddNodeDialog.set(false);
    }
  }

  addStep(type: StepType): void {
    const flowId = this.selectedFlow()?.id;
    let projectId = this.selectedProjectId();
    if (flowId && !projectId) {
      projectId = this.svc.findProjectIdByFlowId(flowId);
    }
    if (flowId && projectId) {
      const name = this.getDefaultStepName(type);
      this.svc.addStep(projectId, flowId, this.addNodeParentId(), name, type);
      this.showAddNodeDialog.set(false);
    }
  }

  private getDefaultStepName(type: StepType): string {
    switch (type) {
      case 'REQUEST': return 'New Request';
      case 'VALIDATION': return 'New Validation';
      case 'DATABASE': return 'New DB Query';
      case 'E2E': return 'New Browser Action';
      case 'INTERCEPT': return 'Network Intercept';
      case 'WAIT': return 'Wait Delay';
      case 'SECURITY': return 'Security Audit';
      case 'MANUAL': return 'Manual User Input';
      default: return 'New Step';
    }
  }

  onRunFlow(): void {
    const flowId = this.selectedFlow()?.id;
    if (flowId) {
      this.svc.runFlow(flowId);
    }
  }

  onToggleFolder(folderId: string): void {
    this.svc.toggleFolder(this.selectedFlow()?.id!, folderId);
  }

  clearLogs(): void {
    this.svc.executionLogs.set([]);
  }

  onDeleteNode(nodeId: string): void {
    this.confirmDelete('Delete Step', 'Are you sure you want to delete this step?', () => {
      this.svc.deleteNode(this.selectedFlow()?.id!, nodeId);
    });
  }

  onNodeChanged(node: FlowNode): void {
    const flowId = this.selectedFlow()?.id;
    if (flowId) {
      this.svc.updateNode(flowId, node.id, node);
    }
  }

  asStep(node: FlowNode): FlowStep {
    return node as FlowStep;
  }

  asFolder(node: FlowNode): FlowFolder {
    return node as FlowFolder;
  }
}
