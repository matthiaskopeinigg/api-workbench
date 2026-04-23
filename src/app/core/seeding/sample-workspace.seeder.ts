import { Injectable } from '@angular/core';
import { v4 as uuidv4 } from 'uuid';
import { CollectionService } from '@core/collection/collection.service';
import { EnvironmentsService } from '@core/environments/environments.service';
import { TestArtifactService } from '@core/testing/test-artifact.service';
import { SessionService } from '@core/session/session.service';
import type { Collection, Folder } from '@models/collection';
import { HttpMethod, type Request } from '@models/request';
import { Environment } from '@models/environment';
import type { LoadTestArtifact } from '@models/testing/load-test';
import { DEFAULT_LOAD_CONFIG, type LoadTestProfile } from '@models/testing/load-test';
import type { TestSuiteArtifact } from '@models/testing/test-suite';
import type { ContractTestArtifact } from '@models/testing/contract-test';
import type { FlowArtifact, FlowNode } from '@models/testing/flow';

/** Session flag so we only merge sample content once per profile. */
const SAMPLE_WORKSPACE_V1 = 'apiWorkbenchSampleWorkspaceV1';

/** Stable ids so saved targets and scopes resolve after relaunch. */
const IDS = {
  env: 'a1000000-0000-4000-8000-000000000001',
  folder: 'a1000000-0000-4000-8000-000000000002',
  reqJsonPost: 'a1000000-0000-4000-8000-000000000010',
  reqHttpbinGet: 'a1000000-0000-4000-8000-000000000011',
  reqReqresUser: 'a1000000-0000-4000-8000-000000000012',
  reqHttpbinDelay: 'a1000000-0000-4000-8000-000000000013',
  reqMockJson: 'a1000000-0000-4000-8000-000000000014',
  loadTest: 'a1000000-0000-4000-8000-000000000020',
  testSuite: 'a1000000-0000-4000-8000-000000000021',
  contractTest: 'a1000000-0000-4000-8000-000000000022',
  flow: 'a1000000-0000-4000-8000-000000000023',
} as const;

const emptyScript = { preRequest: '', postRequest: '' };

function baseRequest(
  id: string,
  title: string,
  method: HttpMethod,
  url: string,
  extra?: Partial<Request>,
): Request {
  return {
    id,
    title,
    url,
    httpMethod: method,
    requestBody: '',
    body: { mode: 'none' as const },
    script: emptyScript,
    ...extra,
  };
}

/**
 * On first open of an empty workspace, adds a folder of public HTTP requests,
 * a shared environment, one load test, test suite, contract test, flow, and
 * a request with mock variants for the local mock server.
 */
@Injectable({ providedIn: 'root' })
export class SampleWorkspaceSeeder {
  constructor(
    private collections: CollectionService,
    private environments: EnvironmentsService,
    private testArtifacts: TestArtifactService,
    private session: SessionService,
  ) {}

  /**
   * Idempotent: skips if the session key is set, or the workspace is non-empty
   * (any requests or nested folders with requests), or the sample folder id exists.
   */
  async runIfEmptyWorkspace(): Promise<void> {
    if (!window.awElectron?.getCollections) {
      return;
    }
    await this.session.load(SAMPLE_WORKSPACE_V1);
    if (this.session.get<{ applied: boolean }>(SAMPLE_WORKSPACE_V1)?.applied) {
      return;
    }
    const cols = this.collections.getCollections();
    const root = cols[0];
    if (!root) {
      return;
    }
    if (this.treeHasUserContent(root) || this.hasSampleFolder(root)) {
      await this.session.save(SAMPLE_WORKSPACE_V1, { applied: true, at: Date.now() });
      return;
    }

    await this.applyEnvironment();
    this.applyFolderAndRequests(root);
    await this.collections.saveCollections([root]);

    await this.createArtifactsIfMissing();

    await this.session.save(SAMPLE_WORKSPACE_V1, { applied: true, at: Date.now() });
  }

  private treeHasUserContent(c: Collection): boolean {
    if (c.requests?.length) {
      return true;
    }
    for (const f of c.folders || []) {
      if (this.folderHasRequests(f)) {
        return true;
      }
    }
    return false;
  }

  private hasSampleFolder(c: Collection): boolean {
    return (c.folders || []).some((f) => f.id === IDS.folder);
  }

  private folderHasRequests(f: Folder): boolean {
    if (f.requests?.length) {
      return true;
    }
    for (const sub of f.folders || []) {
      if (this.folderHasRequests(sub)) {
        return true;
      }
    }
    return false;
  }

  private async applyEnvironment(): Promise<void> {
    const list = this.environments.getEnvironments();
    if (list.some((e) => e.id === IDS.env)) {
      return;
    }
    const next: Environment = {
      id: IDS.env,
      order: list.length,
      title: 'Public APIs (sample)',
      variables: [
        { key: 'jsonPlaceholderBase', value: 'https://jsonplaceholder.typicode.com', description: 'JSONPlaceholder' },
        { key: 'httpbinBase', value: 'https://httpbin.org', description: 'httpbin' },
        { key: 'reqresBase', value: 'https://reqres.in', description: 'Reqres' },
        { key: 'mockLocalPort', value: '9781', description: 'Set mock server to this port or change this + the mock request URL' },
      ],
    };
    await this.environments.saveEnvironment(next);
  }

  private applyFolderAndRequests(root: Collection): void {
    const vMock = uuidv4();
    const mockBody = JSON.stringify({ ok: true, source: 'mock', note: 'Served from API Workbench mock server' });
    const folder: Folder = {
      id: IDS.folder,
      order: 0,
      title: 'Public API samples',
      requests: [
        baseRequest(
          IDS.reqJsonPost,
          'JSONPlaceholder — GET post 1',
          HttpMethod.GET,
          '{{jsonPlaceholderBase}}/posts/1',
        ),
        baseRequest(
          IDS.reqHttpbinGet,
          'httpbin — GET',
          HttpMethod.GET,
          '{{httpbinBase}}/get',
        ),
        baseRequest(
          IDS.reqReqresUser,
          'Reqres — GET user 1',
          HttpMethod.GET,
          '{{reqresBase}}/api/users/1',
        ),
        baseRequest(
          IDS.reqHttpbinDelay,
          'httpbin — delay 1s (load / latency demo)',
          HttpMethod.GET,
          '{{httpbinBase}}/delay/1',
        ),
        baseRequest(
          IDS.reqMockJson,
          'Local mock — start Mock Server on 9781, then GET this URL (see Mock Variants)',
          HttpMethod.GET,
          `http://127.0.0.1:9781/mock/${IDS.reqMockJson}`,
        {
          mockVariants: [
            {
              id: vMock,
              name: '200 JSON',
              statusCode: 200,
              statusText: 'OK',
              headers: [{ key: 'Content-Type', value: 'application/json' }],
              body: mockBody,
              delayMs: 0,
            },
            {
              id: uuidv4(),
              name: '503 error',
              statusCode: 503,
              statusText: 'Service Unavailable',
              body: JSON.stringify({ error: 'unavailable' }),
            },
          ],
          activeMockVariantId: vMock,
        }),
      ],
      folders: [],
    };
    root.folders = [...(root.folders || []), folder];
  }

  private async createArtifactsIfMissing(): Promise<void> {
    const now = Date.now();
    if (!this.testArtifacts.loadTests().some((a) => a.id === IDS.loadTest)) {
      const light: LoadTestProfile = {
        id: 'p-light',
        name: 'Light (default)',
        description: 'A short run with a small RPS cap; good for a quick check.',
        userCustom: false,
        isTemplate: true,
        config: {
          ...DEFAULT_LOAD_CONFIG,
          vus: 2,
          durationSec: 8,
          iterations: null,
          rampUpSec: 1,
          rpsCap: 5,
          thinkMs: 200,
          targets: [
            { kind: 'saved', requestId: IDS.reqJsonPost },
          ],
          captureResponseDetails: false,
        },
      };
      const stress: LoadTestProfile = {
        id: 'p-stress',
        name: 'Stress sample',
        description: 'Higher VUs, no RPS cap — for experiments on a test environment only.',
        userCustom: false,
        isTemplate: true,
        config: {
          ...DEFAULT_LOAD_CONFIG,
          vus: 12,
          durationSec: 20,
          iterations: null,
          rampUpSec: 4,
          rpsCap: null,
          thinkMs: 0,
          targets: [
            { kind: 'saved', requestId: IDS.reqJsonPost },
          ],
          captureResponseDetails: false,
        },
      };
      const lt: LoadTestArtifact = {
        id: IDS.loadTest,
        title: 'Sample: JSONPlaceholder (multi-profile)',
        updatedAt: now,
        activeProfileId: light.id,
        profiles: [light, stress],
        config: light.config,
      };
      await this.testArtifacts.create('loadTests', lt);
    }
    if (!this.testArtifacts.testSuites().some((a) => a.id === IDS.testSuite)) {
      const suite: TestSuiteArtifact = {
        id: IDS.testSuite,
        title: 'Sample: public API smoke',
        updatedAt: now,
        description: 'Hits JSONPlaceholder and httpbin; expects 2xx.',
        variables: [],
        cases: [
          {
            id: uuidv4(),
            name: 'Post 1',
            enabled: true,
            target: { kind: 'saved', requestId: IDS.reqJsonPost },
            assertions: [
              { kind: 'status', expected: 200 },
              { kind: 'body', path: '$.id', op: 'jsonpath-truthy' },
            ],
            extracts: [],
          },
          {
            id: uuidv4(),
            name: 'httpbin GET',
            enabled: true,
            target: { kind: 'saved', requestId: IDS.reqHttpbinGet },
            assertions: [
              { kind: 'status', expected: 200 },
              { kind: 'body', path: '$.url', op: 'jsonpath-truthy' },
            ],
            extracts: [],
          },
        ],
      };
      await this.testArtifacts.create('testSuites', suite);
    }
    if (!this.testArtifacts.contractTests().some((a) => a.id === IDS.contractTest)) {
      const specYaml = `openapi: 3.0.0
info:
  title: JSONPlaceholder
  version: "1.0"
servers:
  - url: https://jsonplaceholder.typicode.com
paths:
  /posts/{id}:
    get:
      summary: Get post
      parameters:
        - name: id
          in: path
          required: true
          schema: { type: string }
      responses:
        "200":
          description: ok
          content:
            application/json:
              schema:
                type: object
`;
      const contract: ContractTestArtifact = {
        id: IDS.contractTest,
        title: 'Sample: OpenAPI (JSONPlaceholder posts)',
        updatedAt: now,
        spec: { kind: 'inline', format: 'yaml', body: specYaml, updatedAt: now },
        scope: { collectionId: 'root', folderId: IDS.folder },
      };
      await this.testArtifacts.create('contractTests', contract);
    }
    if (!this.testArtifacts.flows().some((a) => a.id === IDS.flow)) {
      const nStart = 'flow-start';
      const n1 = 'flow-req-1';
      const n2 = 'flow-assert-1';
      const n3 = 'flow-end-ok';
      const nodes: FlowNode[] = [
        { id: nStart, kind: 'start', label: 'Start', x: 40, y: 120 },
        {
          id: n1,
          kind: 'request',
          label: 'GET post 1',
          x: 220,
          y: 100,
          target: { kind: 'saved', requestId: IDS.reqJsonPost },
        },
        {
          id: n2,
          kind: 'assert',
          label: 'status 200',
          x: 420,
          y: 100,
          expression: 'input && input.status === 200',
          message: 'Expected 200 from JSONPlaceholder',
        },
        { id: n3, kind: 'terminate', label: 'OK', x: 620, y: 100, outcome: 'success' },
      ];
      const flow: FlowArtifact = {
        id: IDS.flow,
        title: 'Sample: fetch post then assert',
        updatedAt: now,
        description: 'Minimal flow using JSONPlaceholder.',
        nodes,
        edges: [
          { id: 'e1', fromNodeId: nStart, fromPort: 'out', toNodeId: n1 },
          { id: 'e2', fromNodeId: n1, fromPort: 'out', toNodeId: n2 },
          { id: 'e3', fromNodeId: n2, fromPort: 'out', toNodeId: n3 },
        ],
        viewport: { x: 0, y: 0, zoom: 1 },
      };
      await this.testArtifacts.create('flows', flow);
    }
  }
}
