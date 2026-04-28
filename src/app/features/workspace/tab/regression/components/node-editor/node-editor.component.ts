import { Component, Input, Output, EventEmitter, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { FlowNode, FlowStep, FlowFolder, StepType, HttpMethod } from '../../models/flow.model';
import { DropdownComponent } from '@features/workspace/shared/dropdown/dropdown.component';
import { VariableInputComponent } from '@shared-app/components/variable-input/variable-input.component';

@Component({
  selector: 'app-flow-node-editor',
  standalone: true,
  imports: [CommonModule, FormsModule, DropdownComponent, VariableInputComponent],
  templateUrl: './node-editor.component.html',
  styleUrl: './node-editor.component.scss'
})
export class FlowNodeEditorComponent {
  @Input({ required: true }) node!: FlowNode;
  @Output() nodeChange = new EventEmitter<FlowNode>();

  httpMethods = [
    { label: 'GET', value: 'GET' },
    { label: 'POST', value: 'POST' },
    { label: 'PUT', value: 'PUT' },
    { label: 'PATCH', value: 'PATCH' },
    { label: 'DELETE', value: 'DELETE' },
    { label: 'HEAD', value: 'HEAD' },
    { label: 'OPTIONS', value: 'OPTIONS' }
  ];

  bodyTypes = [
    { label: 'None', value: 'none' },
    { label: 'JSON', value: 'json' },
    { label: 'Form', value: 'form' },
    { label: 'Raw', value: 'raw' }
  ];

  validationSources = [
    { label: 'Response Body', value: 'response_body' },
    { label: 'Response Status', value: 'response_status' },
    { label: 'Response Header', value: 'response_header' },
    { label: 'Request Body', value: 'request_body' },
    { label: 'Request Header', value: 'request_header' },
    { label: 'Request Param', value: 'request_param' },
    { label: 'Cached Value', value: 'cached_value' }
  ];

  validationOperators = [
    { label: 'Equals', value: 'equals' },
    { label: 'Not Equals', value: 'not_equals' },
    { label: 'Contains', value: 'contains' },
    { label: 'Matches Regex', value: 'matches_regex' },
    { label: 'Greater Than', value: 'greater_than' },
    { label: 'Less Than', value: 'less_than' },
    { label: 'Is Null', value: 'is_null' },
    { label: 'Is Not Null', value: 'is_not_null' },
    { label: 'Exists', value: 'exists' },
    { label: 'Not Exists', value: 'not_exists' },
    { label: 'Is Empty', value: 'is_empty' },
    { label: 'Is Not Empty', value: 'is_not_empty' }
  ];

  dbTypes = [
    { label: 'PostgreSQL', value: 'postgresql' },
    { label: 'MySQL', value: 'mysql' },
    { label: 'MongoDB', value: 'mongodb' },
    { label: 'SQL Server', value: 'mssql' }
  ];

  e2eActions = [
    { label: 'Open Page', value: 'OPEN_PAGE' },
    { label: 'Navigate To', value: 'NAVIGATE_TO' },
    { label: 'Click', value: 'CLICK' },
    { label: 'Type Text', value: 'TYPE_TEXT' },
    { label: 'Wait', value: 'WAIT' },
    { label: 'Screenshot', value: 'SCREENSHOT' },
    { label: 'Assert Element', value: 'ASSERT_ELEMENT' },
    { label: 'Assert URL', value: 'ASSERT_URL' },
    { label: 'Wait for URL', value: 'WAIT_FOR_URL' }
  ];

  asStep(node: FlowNode): FlowStep {
    return node as FlowStep;
  }

  asFolder(node: FlowNode): FlowFolder {
    return node as FlowFolder;
  }

  asRequestConfig(config: any): any {
    return config;
  }

  asValidationConfig(config: any): any {
    return config;
  }

  asDatabaseConfig(config: any): any {
    return config;
  }

  asE2eConfig(config: any): any {
    return config;
  }

  asInterceptConfig(config: any): any {
    return config;
  }

  asWaitConfig(config: any): any {
    return config;
  }

  asSecurityConfig(config: any): any {
    return config;
  }

  asManualConfig(config: any): any {
    return config;
  }

  onChanged(): void {
    this.nodeChange.emit(this.node);
  }

  addHeader(): void {
    if (this.node.type === 'step' && this.node.stepType === 'REQUEST') {
      const config = this.node.config as any;
      config.headers = [...(config.headers || []), { key: '', value: '', enabled: true }];
      this.onChanged();
    }
  }

  removeHeader(index: number): void {
    if (this.node.type === 'step' && this.node.stepType === 'REQUEST') {
      const config = this.node.config as any;
      config.headers = config.headers.filter((_: any, i: number) => i !== index);
      this.onChanged();
    }
  }

  addQueryParam(): void {
    if (this.node.type === 'step' && this.node.stepType === 'REQUEST') {
      const config = this.node.config as any;
      config.queryParams = [...(config.queryParams || []), { key: '', value: '', enabled: true }];
      this.onChanged();
    }
  }

  removeQueryParam(index: number): void {
    if (this.node.type === 'step' && this.node.stepType === 'REQUEST') {
      const config = this.node.config as any;
      config.queryParams = config.queryParams.filter((_: any, i: number) => i !== index);
      this.onChanged();
    }
  }
}
