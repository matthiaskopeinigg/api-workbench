import { Injectable, signal, computed, inject } from '@angular/core';
import { TabService } from '@core/tabs/tab.service';
import {
  Flow,
  FlowNode,
  FlowFolder,
  FlowStep,
  FlowGroup,
  FlowListItem,
  FlowListEntry,
  StepType,
  generateId,
  createDefaultRequestConfig,
  createDefaultValidationConfig,
  createDefaultDatabaseConfig,
  createDefaultE2eConfig,
  createDefaultInterceptConfig,
  createDefaultWaitConfig,
  createDefaultSecurityConfig,
  createDefaultManualConfig,
  InterceptStepConfig,
  Project
} from './models/flow.model';
import { ReleaseRun, FlowRunResult, createNewRun } from './models/regression-run.model';
import { RegressionExecutorService } from './regression-executor.service';

@Injectable({ providedIn: 'root' })
export class RegressionTestingService {
  private readonly executor = inject(RegressionExecutorService);
  private readonly tabSvc = inject(TabService);

  // ── State ──
  readonly projects = signal<Project[]>(this.seedProjects());
  readonly selectedProjectId = signal<string | null>(null);
  readonly selectedFlowId = signal<string | null>(null);
  readonly selectedNodeId = signal<string | null>(null);
  readonly runs = signal<ReleaseRun[]>(this.seedRuns());
  readonly executionLogs = signal<Array<{ message: string, type: string, timestamp: string }>>([]);
  readonly showE2eBrowser = signal<boolean>(true);
  readonly keepE2eBrowserOpen = signal<boolean>(false);

  // Manual input state
  readonly manualInputRequest = signal<{ prompt: string, resolve: (val: string) => void, reject: (err: any) => void } | null>(null);

  findProjectIdByFlowId(flowId: string): string | null {
    const ps = this.projects();
    for (const p of ps) {
      if (this.isFlowInProject(p.flows, flowId)) return p.id;
    }
    return null;
  }

  private isFlowInProject(items: FlowListItem[], flowId: string): boolean {
    for (const item of items) {
      if (item.type === 'flow' && item.flow.id === flowId) return true;
      if (item.type === 'group' && this.isFlowInProject(item.children, flowId)) return true;
    }
    return false;
  }

  readonly allFlows = computed<Flow[]>(() => {
    return this.projects().flatMap(p => this.collectFlows(p.flows));
  });

  readonly selectedProject = computed(() => {
    const id = this.selectedProjectId();
    return this.projects().find(p => p.id === id) ?? null;
  });

  readonly selectedFlow = computed(() => {
    const id = this.selectedFlowId();
    return this.allFlows().find((f) => f.id === id) ?? null;
  });

  readonly selectedNode = computed<FlowNode | null>(() => {
    const flow = this.selectedFlow();
    const nodeId = this.selectedNodeId();
    if (!flow || !nodeId) return null;
    return this.findNodeById(flow.nodes, nodeId);
  });

  // ── Stats ──
  readonly stats = computed(() => {
    const flows = this.allFlows();
    return {
      total: flows.length,
      passed: flows.filter((f) => f.lastRunStatus === 'passed').length,
      failed: flows.filter((f) => f.lastRunStatus === 'failed').length,
      running: flows.filter((f) => f.lastRunStatus === 'running').length,
      totalSteps: flows.reduce((sum, f) => sum + this.countSteps(f.nodes), 0),
    };
  });

  // ── Project CRUD ──
  createProject(name: string, description = ''): Project {
    const project: Project = {
      id: generateId(),
      name,
      description,
      createdAt: new Date().toISOString(),
      flows: [],
      lastRunStatus: 'never',
      lastRunAt: null
    };
    this.projects.update(ps => [...ps, project]);
    this.selectedProjectId.set(project.id);
    return project;
  }

  deleteProject(projectId: string): void {
    this.projects.update(ps => ps.filter(p => p.id !== projectId));
    if (this.selectedProjectId() === projectId) {
      this.selectedProjectId.set(null);
      this.selectedFlowId.set(null);
    }
  }

  renameProject(projectId: string, name: string): void {
    this.projects.update(ps => ps.map(p => p.id === projectId ? { ...p, name } : p));
  }

  // ── Flow Folder CRUD ──

  createFlowGroup(projectId: string, parentGroupId: string | null, name: string): FlowGroup {
    const group: FlowGroup = {
      id: generateId(),
      type: 'group',
      name,
      expanded: true,
      children: [],
    };
    this.projects.update(ps => ps.map(p => {
      if (p.id !== projectId) return p;
      if (!parentGroupId) return { ...p, flows: [...p.flows, group] };
      return { ...p, flows: this.insertIntoGroup(p.flows, parentGroupId, group) };
    }));
    return group;
  }

  deleteFlowGroup(projectId: string, groupId: string): void {
    this.projects.update(ps => ps.map(p => {
      if (p.id !== projectId) return p;
      return { ...p, flows: this.removeFromTree(p.flows, groupId) };
    }));
  }

  renameFlowGroup(projectId: string, groupId: string, name: string): void {
    this.projects.update(ps => ps.map(p => {
      if (p.id !== projectId) return p;
      return { ...p, flows: this.updateGroupInTree(p.flows, groupId, { name }) };
    }));
  }

  toggleFlowGroup(projectId: string, groupId: string): void {
    this.projects.update(ps => ps.map(p => {
      if (p.id !== projectId) return p;
      return { ...p, flows: this.toggleGroupInTree(p.flows, groupId) };
    }));
  }

  // ── Release Runs ──

  createRun(versionTag: string, flowIds: string[], description = ''): ReleaseRun {
    const run = createNewRun(versionTag, flowIds, description);
    this.runs.update((rs) => [run, ...rs]);
    return run;
  }

  async executeRun(runId: string, options?: { flowIds?: string[] }): Promise<void> {
    const run = this.runs().find((r) => r.id === runId);
    if (!run) return;

    this.updateRun(runId, { status: 'running', startedAt: new Date().toISOString() });

    const flowsToRun = options?.flowIds || run.flowIds;
    const currentResults = options?.flowIds ? [...run.results] : [];
    const flows = this.allFlows();

    for (const flowId of flowsToRun) {
      const flow = flows.find((f) => f.id === flowId);
      if (!flow) continue;

      const state = await this.executor.executeFlow(
        flow,
        undefined,
        undefined,
        undefined,
        this.createManualInputHandler()
      );
      
      const stepResults = Object.values(state.results);
      const flowPassed = stepResults.every(r => r.status === 'passed');
      const duration = stepResults.reduce((sum, r) => sum + (r.durationMs || 0), 0);

      const result: FlowRunResult = {
        flowId,
        flowName: flow.name,
        status: flowPassed ? 'passed' : 'failed',
        durationMs: duration,
      };

      // Merge or update results
      const existingIdx = currentResults.findIndex(r => r.flowId === flowId);
      if (existingIdx >= 0) {
        currentResults[existingIdx] = result;
      } else {
        currentResults.push(result);
      }

      this.updateRun(runId, { results: [...currentResults] });
    }

    const allPassed = currentResults.every((r) => r.status === 'passed');
    const allFailed = currentResults.every((r) => r.status === 'failed');

    this.updateRun(runId, {
      status: allPassed ? 'passed' : allFailed ? 'failed' : 'partial',
      completedAt: new Date().toISOString(),
    });
  }

  // ── Tab Helpers ──
  openProjectTab(id: string, name: string): void {
    this.tabSvc.openRegressionTab(`reg:p:${id}`, name);
  }

  openFlowTab(id: string, name: string): void {
    this.tabSvc.openRegressionTab(`reg:f:${id}`, name);
  }

  async runFlow(flowId: string): Promise<void> {
    const flow = this.allFlows().find(f => f.id === flowId);
    if (!flow) return;

    this.projects.update(ps => ps.map(p => ({
      ...p,
      flows: this.mapFlowInTree(p.flows, flowId, { lastRunStatus: 'running' })
    })));

    // Clear previous state
    this.resetStepStatuses(flowId);
    this.executionLogs.set([]);
    this.projects.update(ps => [...ps]);

    const state = await this.executor.executeFlow(
      flow,
      (stepId, status, error) => {
        this.updateStepStatus(flowId, stepId, status, error);
      },
      (message, type) => {
        this.executionLogs.update(logs => [
          ...logs,
          { message, type, timestamp: new Date().toLocaleTimeString() }
        ]);
      },
      (stepId, err, state) => {
        this.updateStepStatus(flowId, stepId, 'failed', err.message, state.lastResponse);
        this.executionLogs.update(logs => [
          ...logs,
          { message: `Step failed: ${err.message}`, type: 'error', timestamp: new Date().toLocaleTimeString() }
        ]);
      },
      this.createManualInputHandler(),
      this.showE2eBrowser()
    );

    const passed = Object.values(state.results).every(r => (r as any).status === 'passed');

    this.updateFlow(flowId, {
      lastRunStatus: passed ? 'passed' : 'failed',
      lastRunAt: new Date().toISOString()
    } as any);

    if (!this.keepE2eBrowserOpen()) {
      await this.executor.closeBrowser(this.showE2eBrowser());
    }
  }

  updateStepStatus(flowId: string, stepId: string, status: any, error?: string, errorDetails?: any): void {
    this.projects.update(ps => ps.map(p => ({
      ...p,
      flows: this.mapFlowNodesInTree(p.flows, flowId, (nodes) => {
        return this.mapNodes(nodes, stepId, { lastRunStatus: status, error, errorDetails });
      })
    })));
  }

  private resetStepStatuses(flowId: string): void {
    this.projects.update(ps => ps.map(p => ({
      ...p,
      flows: this.mapFlowNodesInTree(p.flows, flowId, (nodes) => {
        return this.deepResetStatus(nodes);
      })
    })));
  }

  private deepResetStatus(nodes: FlowNode[]): FlowNode[] {
    return nodes.map(n => {
      if (n.type === 'step') return { ...n, lastRunStatus: n.enabled ? 'waiting' : 'never', error: undefined, errorDetails: undefined };
      if (n.type === 'folder') return { ...n, children: this.deepResetStatus(n.children) };
      return n;
    });
  }

  private updateRun(runId: string, partial: Partial<ReleaseRun>): void {
    this.runs.update((rs) => rs.map((r) => (r.id === runId ? { ...r, ...partial } : r)));
  }

  deleteRun(runId: string): void {
    this.runs.update((rs) => rs.filter((r) => r.id !== runId));
  }

  // ── Flow CRUD ──

  createFlow(projectId: string, parentGroupId: string | null, name: string): Flow {
    const flow: Flow = {
      id: generateId(),
      name,
      description: '',
      lastRunStatus: 'never',
      lastRunAt: null,
      owner: 'you',
      createdAt: new Date().toISOString(),
      nodes: [],
      tags: [],
    };
    const entry: FlowListEntry = { type: 'flow', flow };
    this.projects.update(ps => ps.map(p => {
      if (p.id !== projectId) return p;
      if (!parentGroupId) return { ...p, flows: [...p.flows, entry] };
      return { ...p, flows: this.insertIntoGroup(p.flows, parentGroupId, entry) };
    }));
    return flow;
  }

  updateFlow(flowId: string, partial: Partial<Pick<Flow, 'name' | 'description' | 'tags'>>): void {
    this.projects.update(ps => ps.map(p => ({
      ...p,
      flows: this.mapFlowInTree(p.flows, flowId, partial)
    })));
  }

  deleteFlow(flowId: string): void {
    this.projects.update(ps => ps.map(p => ({
      ...p,
      flows: this.removeFlowFromTree(p.flows, flowId)
    })));
    if (this.selectedFlowId() === flowId) {
      this.selectedFlowId.set(null);
      this.selectedNodeId.set(null);
    }
  }

  selectFlow(flowId: string | null): void {
    this.selectedFlowId.set(flowId);
    this.selectedNodeId.set(null);
  }

  // ── Node CRUD (steps/folders within a flow) ──

  addFolder(projectId: string, flowId: string, parentId: string | null, name: string): FlowFolder {
    const folder: FlowFolder = {
      id: generateId(),
      type: 'folder',
      name,
      parentId,
      children: [],
      expanded: true,
    };
    this.insertFlowNode(projectId, flowId, parentId, folder);
    return folder;
  }

  addStep(projectId: string, flowId: string, parentId: string | null, name: string, stepType: StepType): FlowStep {
    const step: FlowStep = {
      id: generateId(),
      type: 'step',
      name,
      parentId,
      stepType,
      config: this.defaultConfigFor(stepType),
      enabled: true,
    };
    this.insertFlowNode(projectId, flowId, parentId, step);
    return step;
  }

  updateNode(flowId: string, nodeId: string, partial: Partial<FlowNode>): void {
    this.projects.update(ps => ps.map(p => ({
      ...p,
      flows: this.mapFlowNodesInTree(p.flows, flowId, (nodes) => this.mapNodes(nodes, nodeId, partial))
    })));
  }

  deleteNode(flowId: string, nodeId: string): void {
    this.projects.update(ps => ps.map(p => ({
      ...p,
      flows: this.mapFlowNodesInTree(p.flows, flowId, (nodes) => this.removeNode(nodes, nodeId))
    })));
    if (this.selectedNodeId() === nodeId) {
      this.selectedNodeId.set(null);
    }
  }

  selectNode(nodeId: string | null): void {
    this.selectedNodeId.set(nodeId);
  }

  toggleFolder(flowId: string, folderId: string): void {
    this.projects.update(ps => ps.map(p => ({
      ...p,
      flows: this.mapFlowNodesInTree(p.flows, flowId, (nodes) => {
        const folder = this.findNodeById(nodes, folderId) as FlowFolder | null;
        if (!folder) return nodes;
        return this.mapNodes(nodes, folderId, { expanded: !folder.expanded });
      })
    })));
  }

  private createManualInputHandler() {
    return (prompt: string, timeout: number): Promise<string> => {
      return new Promise((resolve, reject) => {
        this.manualInputRequest.set({ prompt, resolve, reject });
        if (timeout > 0) {
          setTimeout(() => {
            if (this.manualInputRequest()?.prompt === prompt) {
              this.manualInputRequest.set(null);
              reject(new Error('Manual input timed out'));
            }
          }, timeout);
        }
      });
    };
  }

  // ── Internal: flow tree helpers ──

  findNodeById(nodes: FlowNode[], id: string): FlowNode | null {
    for (const node of nodes) {
      if (node.id === id) return node;
      if (node.type === 'folder') {
        const found = this.findNodeById(node.children, id);
        if (found) return found;
      }
    }
    return null;
  }

  private collectFlows(items: FlowListItem[]): Flow[] {
    const result: Flow[] = [];
    for (const item of items) {
      if (item.type === 'flow') {
        result.push(item.flow);
      } else if (item.type === 'group') {
        result.push(...this.collectFlows(item.children));
      }
    }
    return result;
  }

  private insertIntoGroup(items: FlowListItem[], groupId: string, newItem: FlowListItem): FlowListItem[] {
    return items.map((item) => {
      if (item.type === 'group' && item.id === groupId) {
        return { ...item, children: [...item.children, newItem] };
      }
      if (item.type === 'group') {
        return { ...item, children: this.insertIntoGroup(item.children, groupId, newItem) };
      }
      return item;
    });
  }

  private removeFromTree(items: FlowListItem[], id: string): FlowListItem[] {
    return items
      .filter((item) => !(item.type === 'group' && item.id === id))
      .map((item) => {
        if (item.type === 'group') {
          return { ...item, children: this.removeFromTree(item.children, id) };
        }
        return item;
      });
  }

  private removeFlowFromTree(items: FlowListItem[], flowId: string): FlowListItem[] {
    return items
      .filter((item) => !(item.type === 'flow' && item.flow.id === flowId))
      .map((item) => {
        if (item.type === 'group') {
          return { ...item, children: this.removeFlowFromTree(item.children, flowId) };
        }
        return item;
      });
  }

  private updateGroupInTree(items: FlowListItem[], groupId: string, partial: Partial<FlowGroup>): FlowListItem[] {
    return items.map((item) => {
      if (item.type === 'group' && item.id === groupId) {
        return { ...item, ...partial };
      }
      if (item.type === 'group') {
        return { ...item, children: this.updateGroupInTree(item.children, groupId, partial) };
      }
      return item;
    });
  }

  private toggleGroupInTree(items: FlowListItem[], groupId: string): FlowListItem[] {
    return items.map((item) => {
      if (item.type === 'group' && item.id === groupId) {
        return { ...item, expanded: !item.expanded };
      }
      if (item.type === 'group') {
        return { ...item, children: this.toggleGroupInTree(item.children, groupId) };
      }
      return item;
    });
  }

  private mapFlowInTree(items: FlowListItem[], flowId: string, partial: Partial<Flow>): FlowListItem[] {
    return items.map((item) => {
      if (item.type === 'flow' && item.flow.id === flowId) {
        return { ...item, flow: { ...item.flow, ...partial } };
      }
      if (item.type === 'group') {
        return { ...item, children: this.mapFlowInTree(item.children, flowId, partial) };
      }
      return item;
    });
  }

  private mapFlowNodesInTree(items: FlowListItem[], flowId: string, fn: (nodes: FlowNode[]) => FlowNode[]): FlowListItem[] {
    return items.map((item) => {
      if (item.type === 'flow' && item.flow.id === flowId) {
        return { ...item, flow: { ...item.flow, nodes: fn(item.flow.nodes) } };
      }
      if (item.type === 'group') {
        return { ...item, children: this.mapFlowNodesInTree(item.children, flowId, fn) };
      }
      return item;
    });
  }

  // ── Internal: flow node helpers ──

  private insertFlowNode(projectId: string, flowId: string, parentId: string | null, node: FlowNode): void {
    this.projects.update(ps => ps.map(p => {
      if (p.id !== projectId) return p;
      return {
        ...p,
        flows: this.mapFlowNodesInTree(p.flows, flowId, (nodes) => {
          if (!parentId) return [...nodes, node];
          return this.insertIntoParent(nodes, parentId, node);
        })
      };
    }));
  }

  private insertIntoParent(nodes: FlowNode[], parentId: string, node: FlowNode): FlowNode[] {
    return nodes.map((n) => {
      if (n.id === parentId && n.type === 'folder') {
        return { ...n, children: [...n.children, node] } as FlowFolder;
      }
      if (n.type === 'folder') {
        return { ...n, children: this.insertIntoParent(n.children, parentId, node) } as FlowFolder;
      }
      return n;
    });
  }

  private mapNodes(nodes: FlowNode[], nodeId: string, partial: Partial<FlowNode>): FlowNode[] {
    return nodes.map((n) => {
      if (n.id === nodeId) return { ...n, ...partial } as FlowNode;
      if (n.type === 'folder') return { ...n, children: this.mapNodes(n.children, nodeId, partial) } as FlowFolder;
      return n;
    });
  }

  private removeNode(nodes: FlowNode[], nodeId: string): FlowNode[] {
    return nodes
      .filter((n) => n.id !== nodeId)
      .map((n) => {
        if (n.type === 'folder') return { ...n, children: this.removeNode(n.children, nodeId) } as FlowFolder;
        return n;
      });
  }


  countSteps(nodes: FlowNode[]): number {
    let count = 0;
    for (const n of nodes) {
      if (n.type === 'step') count++;
      if (n.type === 'folder') count += this.countSteps(n.children);
    }
    return count;
  }

  private defaultConfigFor(type: StepType) {
    switch (type) {
      case 'REQUEST': return createDefaultRequestConfig();
      case 'VALIDATION': return createDefaultValidationConfig();
      case 'DATABASE': return createDefaultDatabaseConfig();
      case 'E2E': return createDefaultE2eConfig();
      case 'INTERCEPT': return createDefaultInterceptConfig();
      case 'WAIT': return createDefaultWaitConfig();
      case 'SECURITY': return createDefaultSecurityConfig();
      case 'MANUAL': return createDefaultManualConfig();
      default: return createDefaultRequestConfig();
    }
  }

  // ── Seed data ──

  private seedProjects(): Project[] {
    const magentaFlow: Flow = {
      id: 'f-magenta',
      name: 'Magenta.at Login E2E',
      description: 'End-to-end authentication flow for Magenta customer portal',
      lastRunStatus: 'never',
      lastRunAt: null,
      owner: 'Quality Assurance',
      createdAt: new Date().toISOString(),
      tags: ['e2e', 'magenta', 'critical'],
      nodes: [
        { id: 'm1', type: 'step', name: 'Open Login Page', parentId: null, stepType: 'E2E', enabled: true, config: { action: 'OPEN_PAGE', selector: '', value: 'https://www.magenta.at/mein-magenta-login/', timeout: 10000 } },
        { id: 'm3', type: 'step', name: 'Enter Username', parentId: null, stepType: 'E2E', enabled: true, config: { action: 'TYPE_TEXT', selector: '#ang-email', value: 'YOUR_USERNAME', timeout: 5000 } },
        { id: 'm4', type: 'step', name: 'Enter Password', parentId: null, stepType: 'E2E', enabled: true, config: { action: 'TYPE_TEXT', selector: '#ang-password', value: 'YOUR_PASSWORD', timeout: 5000 } },
        { id: 'm5', type: 'step', name: 'Submit & Intercept Login', parentId: null, stepType: 'INTERCEPT', enabled: true, config: { urlPattern: '/v1/login/usernamepassword', method: 'POST', timeout: 10000, triggerAction: 'CLICK', selector: '[mte2elocator="login-button"]' } },
        { id: 'm5_v', type: 'step', name: 'Validate Login API Response', parentId: null, stepType: 'VALIDATION', enabled: true, config: { source: 'response_status', expression: '', operator: 'equals', expected: '400' } },
        { id: 'm6', type: 'step', name: 'Verify Dashboard Redirect', parentId: null, stepType: 'E2E', enabled: true, config: { action: 'WAIT_FOR_URL', selector: '/mein-magenta-kabel', value: '', timeout: 10000 } }
      ]
    };

    const e2eProject: Project = {
      id: 'p-e2e',
      name: 'E2E Suites',
      description: 'End-to-end user journey tests',
      createdAt: new Date().toISOString(),
      flows: [{ type: 'flow', flow: magentaFlow }],
      lastRunStatus: 'never',
      lastRunAt: null
    };

    return [e2eProject];
  }

  private seedRuns(): ReleaseRun[] {
    return [];
  }
}
