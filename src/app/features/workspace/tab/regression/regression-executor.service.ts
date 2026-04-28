import { Injectable, inject } from '@angular/core';
import { RequestService } from '@core/http/request.service';
import { 
  Flow, 
  FlowNode, 
  FlowStep, 
  FlowFolder, 
  RequestStepConfig, 
  ValidationStepConfig,
  DatabaseStepConfig,
  E2eStepConfig,
  InterceptStepConfig,
  WaitStepConfig,
  SecurityStepConfig,
  ManualStepConfig,
  StepType
} from './models/flow.model';
import { IpcHttpRequest } from '@models/ipc-http-request';
import { IpcHttpResponse } from '@models/ipc-http-response';

export interface StepResult {
  nodeId: string;
  nodeName: string;
  status: 'passed' | 'failed' | 'skipped' | 'running';
  error?: string;
  durationMs?: number;
  response?: IpcHttpResponse;
}

export interface FlowExecutionState {
  variables: Record<string, any>;
  lastResponse: IpcHttpResponse | null;
  results: Record<string, StepResult>;
}

@Injectable({ providedIn: 'root' })
export class RegressionExecutorService {
  public readonly requestSvc = inject(RequestService);

  async executeFlow(
    flow: Flow, 
    onStepProgress?: (stepId: string, status: StepResult['status'], error?: string) => void,
    onLog?: (message: string, type: 'info' | 'error' | 'success') => void,
    onFailure?: (stepId: string, error: Error, state: FlowExecutionState) => void,
    onManualInput?: (prompt: string, timeout: number) => Promise<string>,
    showBrowser: boolean = true
  ): Promise<FlowExecutionState> {
    onLog?.(`Starting flow execution: ${flow.name}`, 'info');
    const state: FlowExecutionState = {
      variables: {},
      lastResponse: null,
      results: {},
    };

    // Flatten nodes for sequential execution
    const flatNodes = this.flattenNodes(flow.nodes);

    for (const node of flatNodes) {
      if (node.type === 'folder') continue; // Folders are structural
      
      const step = node as FlowStep;
      if (!step.enabled) {
        state.results[step.id] = { nodeId: step.id, nodeName: step.name, status: 'skipped' };
        onStepProgress?.(step.id, 'skipped');
        continue;
      }

      state.results[step.id] = { nodeId: step.id, nodeName: step.name, status: 'running' };
      onStepProgress?.(step.id, 'running');
      onLog?.(`Running step: ${step.name} (${step.stepType})`, 'info');
      
      const start = Date.now();
      try {
        await this.executeStep(step, state, showBrowser, onManualInput);
        state.results[step.id].status = 'passed';
        onStepProgress?.(step.id, 'passed');
        onLog?.(`Step passed: ${step.name} (${Date.now() - start}ms)`, 'success');
      } catch (err: any) {
        state.results[step.id].status = 'failed';
        state.results[step.id].error = err.message || 'Unknown error';
        onStepProgress?.(step.id, 'failed', state.results[step.id].error);
        onLog?.(`Step failed: ${step.name} - ${state.results[step.id].error}`, 'error');
        onFailure?.(step.id, err, state);
        
        state.results[step.id].durationMs = Date.now() - start;
        break; 
      }
      state.results[step.id].durationMs = Date.now() - start;
    }

    onLog?.(`Flow execution complete.`, 'info');
    return state;
  }

  private async executeStep(step: FlowStep, state: FlowExecutionState, showBrowser: boolean, onManualInput?: (prompt: string, timeout: number) => Promise<string>): Promise<void> {
    switch (step.stepType) {
      case 'REQUEST':
        await this.runRequestStep(step.config as RequestStepConfig, state);
        break;
      case 'VALIDATION':
        this.runValidationStep(step.config as ValidationStepConfig, state);
        break;
      case 'DATABASE':
        // Mock DB query
        await new Promise(r => setTimeout(r, 200));
        break;
      case 'E2E':
        await this.runE2eStep(step.config as E2eStepConfig, state, showBrowser);
        break;
      case 'INTERCEPT':
        await this.runInterceptStep(step.config as InterceptStepConfig, state, showBrowser);
        break;
      case 'WAIT':
        await this.runWaitStep(step.config as WaitStepConfig);
        break;
      case 'SECURITY':
        await this.runSecurityStep(step.config as SecurityStepConfig, state);
        break;
      case 'MANUAL':
        await this.runManualStep(step.config as ManualStepConfig, state, onManualInput);
        break;
    }
}

  private async runWaitStep(config: WaitStepConfig): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, config.durationMs));
  }

  private async runManualStep(config: ManualStepConfig, state: FlowExecutionState, onManualInput?: (prompt: string, timeout: number) => Promise<string>): Promise<void> {
    if (!onManualInput) {
      throw new Error('Manual input required but no handler provided');
    }
    const result = await onManualInput(config.prompt, config.timeout);
    if (config.variableName) {
      state.variables[config.variableName] = result;
    }
  }

  private async runSecurityStep(config: SecurityStepConfig, state: FlowExecutionState): Promise<void> {
    // This would call the SecurityService or similar
    console.log(`[Executor] Running ${config.scanType} scan...`);
    // Simulating delay
    await new Promise(resolve => setTimeout(resolve, 1500));
  }

  private async runInterceptStep(config: InterceptStepConfig, state: FlowExecutionState, showBrowser: boolean): Promise<void> {
    // 1. Start interception in Electron
    await (window as any).awElectron.e2eExecute({
      action: 'START_INTERCEPT',
      value: config.urlPattern,
      show: showBrowser
    });

    // 2. Perform the trigger action if specified
    if (config.triggerAction) {
      await (window as any).awElectron.e2eExecute({
        action: config.triggerAction,
        selector: this.resolvePlaceholders(config.selector || '', state.variables),
        value: this.resolvePlaceholders(config.value || '', state.variables),
        show: showBrowser
      });
    }

    // 3. Wait for the response
    const result = await (window as any).awElectron.e2eExecute({
      action: 'WAIT_FOR_INTERCEPT',
      value: config.urlPattern,
      timeout: config.timeout,
      show: showBrowser
    });

    if (result.success && (result as any).data) {
      const resp = (result as any).data;
      state.lastResponse = {
        status: resp.status,
        headers: resp.headers,
        body: resp.body
      };
      
      if (config.variableName) {
        state.variables[config.variableName] = resp.body;
      }
    } else {
      throw new Error(`Failed to intercept request: ${result.error || 'Unknown error'}`);
    }
  }

  private async runE2eStep(config: E2eStepConfig, state: FlowExecutionState, showBrowser: boolean): Promise<void> {
    const selector = this.resolvePlaceholders(config.selector, state.variables);
    const value = this.resolvePlaceholders(config.value, state.variables);

    const logType = showBrowser ? 'Visible' : 'Hidden';
    console.log(`[Executor] E2E Action: ${config.action} (${logType} Browser)`);

    const result = await (window as any).awElectron.e2eExecute({
      action: config.action,
      selector,
      value,
      timeout: config.timeout,
      show: showBrowser
    });

    if (!result.success) {
      throw new Error(`E2E Action [${config.action}] failed: ${result.error}`);
    }
  }

  private async runRequestStep(config: RequestStepConfig, state: FlowExecutionState): Promise<void> {
    const url = this.resolvePlaceholders(config.url, state.variables);
    const body = this.resolvePlaceholders(config.body, state.variables);
    
    const headers: Record<string, string> = {};
    config.headers.filter(h => h.enabled).forEach(h => {
      headers[h.key] = this.resolvePlaceholders(h.value, state.variables);
    });

    const params: Record<string, string> = {};
    config.queryParams.filter(p => p.enabled).forEach(p => {
      params[p.key] = this.resolvePlaceholders(p.value, state.variables);
    });

    const ipcReq: IpcHttpRequest = {
      method: config.method,
      url,
      headers,
      params,
      body,
    };

    const response = await this.requestSvc.sendRequest(ipcReq);
    if (!response) {
      throw new Error('No response received from request');
    }
    state.lastResponse = response;
  }

  private runValidationStep(config: ValidationStepConfig, state: FlowExecutionState): void {
    let actual: any;
    
    switch (config.source) {
      case 'response_status':
        actual = state.lastResponse?.status;
        break;
      case 'response_body':
        actual = this.extractFromBody(state.lastResponse?.body as string | undefined, config.expression);
        break;
      case 'response_header':
        const headerVal = state.lastResponse?.headers[config.expression.toLowerCase()];
        actual = Array.isArray(headerVal) ? headerVal[0] : headerVal;
        break;
      case 'cached_value':
        const val = state.variables[config.expression.split('.')[0]];
        if (config.expression.includes('.')) {
          const path = config.expression.substring(config.expression.indexOf('.') + 1);
          actual = this.extractFromBody(typeof val === 'string' ? val : JSON.stringify(val), path);
        } else {
          actual = val;
        }
        break;
    }

    const expected = this.resolvePlaceholders(config.expected, state.variables);
    const passed = this.compare(actual, config.operator, expected);

    if (!passed) {
      throw new Error(`Validation failed: Expected ${expected} ${config.operator} ${actual}`);
    }
  }

  private resolvePlaceholders(input: string, vars: Record<string, any>): string {
    if (!input) return input;
    return input.replace(/\{\{(.+?)\}\}/g, (_, key) => {
      return vars[key.trim()] ?? `{{${key}}}`;
    });
  }

  private extractFromBody(body: string | undefined, expression: string): any {
    if (!body || !expression) return body;
    try {
      const json = JSON.parse(body);
      // Simple dot notation: data.items.0.id
      return expression.split('.').reduce((obj, key) => obj?.[key], json);
    } catch {
      return body;
    }
  }

  private compare(actual: any, operator: string, expected: any): boolean {
    switch (operator) {
      case 'equals': return String(actual) === String(expected);
      case 'not_equals': return String(actual) !== String(expected);
      case 'contains': return String(actual).includes(String(expected));
      case 'is_null': return actual === null || actual === undefined;
      case 'is_not_null': return actual !== null && actual !== undefined;
      case 'greater_than': return Number(actual) > Number(expected);
      case 'less_than': return Number(actual) < Number(expected);
      case 'exists': return actual !== null && actual !== undefined;
      case 'not_exists': return actual === null || actual === undefined;
      case 'is_empty': return !actual || (Array.isArray(actual) && actual.length === 0) || (typeof actual === 'string' && actual.trim() === '');
      case 'is_not_empty': return !!actual && (!Array.isArray(actual) || actual.length > 0) && (typeof actual !== 'string' || actual.trim() !== '');
      default: return false;
    }
  }

  private flattenNodes(nodes: FlowNode[]): FlowNode[] {
    const flat: FlowNode[] = [];
    for (const node of nodes) {
      flat.push(node);
      if (node.type === 'folder') {
        flat.push(...this.flattenNodes(node.children));
      }
    }
    return flat;
  }

  async closeBrowser(show: boolean = true): Promise<void> {
    await (window as any).awElectron.e2eExecute({
      action: 'CLOSE',
      show: show
    });
  }
}
