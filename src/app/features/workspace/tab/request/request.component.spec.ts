import { ComponentFixture, TestBed, fakeAsync, tick } from '@angular/core/testing';
import { RequestComponent } from './request.component';
import { RequestService } from '@core/request.service';
import { RequestHistoryService } from '@core/request-history.service';
import { SettingsService } from '@core/settings.service';
import { CollectionService } from '@core/collection.service';
import { EnvironmentsService } from '@core/environments.service';
import { TabItem, TabType } from '@core/tab.service';
import { HttpMethod } from '@models/request';
import { of } from 'rxjs';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { SecurityContext } from '@angular/core';
import { DomSanitizer } from '@angular/platform-browser';
import { CodeEditorComponent } from '../../shared/code-editor/code-editor.component';
import { VariableInputComponent } from '@shared-app/components/variable-input/variable-input.component';
import { ScriptService } from '@core/script.service';

describe('RequestComponent', () => {
  let component: RequestComponent;
  let fixture: ComponentFixture<RequestComponent>;

  let requestServiceSpy: jasmine.SpyObj<RequestService>;
  let requestHistoryServiceSpy: jasmine.SpyObj<RequestHistoryService>;
  let settingsServiceSpy: jasmine.SpyObj<SettingsService>;
  let collectionServiceSpy: jasmine.SpyObj<CollectionService>;
  let environmentsServiceSpy: jasmine.SpyObj<EnvironmentsService>;
  let scriptServiceSpy: jasmine.SpyObj<ScriptService>;

  const mockTab: TabItem = {
    id: 'req-1',
    title: 'Test Request',
    type: TabType.REQUEST
  };

  const mockRequest = {
    id: 'req-1',
    title: 'Test Request',
    httpMethod: HttpMethod.GET,
    url: 'https://api.example.com',
    httpHeaders: [],
    httpParameters: [],
    requestBody: '{}',
    script: { preRequest: '', postRequest: '' }
  };

  const mockSettings = {
    headers: { addDefaultHeaders: false },
    requests: { timeoutMs: 5000 },
    retries: {},
    dns: {},
    proxy: {},
    ssl: { certificates: [] }
  };

  beforeEach(async () => {
    requestServiceSpy = jasmine.createSpyObj('RequestService', ['sendRequest', 'getCachedResponse', 'cacheResponse']);
    requestHistoryServiceSpy = jasmine.createSpyObj('RequestHistoryService', ['getHistory', 'saveHistory']);
    settingsServiceSpy = jasmine.createSpyObj('SettingsService', ['getSettings']);
    collectionServiceSpy = jasmine.createSpyObj('CollectionService', ['findRequestById', 'updateRequest', 'getParentFolders', 'flushPendingSaves']);
    collectionServiceSpy.flushPendingSaves.and.returnValue(Promise.resolve());
    environmentsServiceSpy = jasmine.createSpyObj('EnvironmentsService', ['getEnvironmentsObservable', 'getActiveContextAsObservable', 'getActiveContext']);
    scriptServiceSpy = jasmine.createSpyObj('ScriptService', ['runScript']);
    scriptServiceSpy.runScript.and.callFake(async (code: string, _ctx: unknown) => {
      const envChanges: Array<{ op: 'set' | 'unset'; key: string; value?: string }> = [];
      const testResults: Array<{ name: string; passed: boolean; message?: string }> = [];
      if (code.includes('test_var')) {
        envChanges.push({ op: 'set', key: 'test_var', value: 'hello' });
      }
      if (code.includes('auth_token')) {
        envChanges.push({ op: 'set', key: 'auth_token', value: 'abc-123' });
      }
      if (code.includes('pm.test')) {
        testResults.push({ name: 'Stubbed test', passed: true });
      }
      return { envChanges, testResults, consoleLogs: [], errors: [] };
    });

    collectionServiceSpy.findRequestById.and.returnValue(mockRequest as any);
    settingsServiceSpy.getSettings.and.returnValue(mockSettings as any);
    environmentsServiceSpy.getEnvironmentsObservable.and.returnValue(of([]));
    environmentsServiceSpy.getActiveContextAsObservable.and.returnValue(of(null));
    requestHistoryServiceSpy.getHistory.and.returnValue({ entries: [] });
    collectionServiceSpy.getParentFolders.and.returnValue([]);

    await TestBed.configureTestingModule({
      imports: [
        CommonModule,
        FormsModule,
        RequestComponent, 
        CodeEditorComponent,
        VariableInputComponent
      ],
      providers: [
        { provide: RequestService, useValue: requestServiceSpy },
        { provide: RequestHistoryService, useValue: requestHistoryServiceSpy },
        { provide: SettingsService, useValue: settingsServiceSpy },
        { provide: CollectionService, useValue: collectionServiceSpy },
        { provide: EnvironmentsService, useValue: environmentsServiceSpy },
        { provide: ScriptService, useValue: scriptServiceSpy },
        {
          provide: DomSanitizer,
          useValue: {
            sanitize: (_ctx: SecurityContext, value: string | null) => value ?? '',
          } as DomSanitizer,
        },
      ]
    }).compileComponents();

    fixture = TestBed.createComponent(RequestComponent);
    component = fixture.componentInstance;
    component.tab = mockTab;
    fixture.detectChanges();
  });

  it('should create and load request data', () => {
    expect(component).toBeTruthy();
    expect(component.request).toBeDefined();
    expect(component.request.url).toBe('https://api.example.com');
    expect(collectionServiceSpy.findRequestById).toHaveBeenCalledWith('req-1');
  });

  it('should update HTTP method', () => {
    component.updateMethod('POST');
    expect(component.request.httpMethod).toBe(HttpMethod.POST);
    expect(collectionServiceSpy.updateRequest).toHaveBeenCalled();
  });

  it('should update URL and auto-prepend protocol', () => {
    const inputEvent = { target: { value: 'google.com' } } as any;
    component.updateUrl(inputEvent);
    expect(component.request.url).toBe('https://google.com');
  });

  it('should send request and handle response', fakeAsync(() => {
    const mockResponse = {
      status: 200,
      statusText: 'OK',
      headers: { 'content-type': 'application/json' },
      body: { data: 'success' },
      timeMs: 120,
      size: 500
    };

    requestServiceSpy.sendRequest.and.returnValue(Promise.resolve(mockResponse as any));

    component.sendRequest();
    expect(component.isLoading).toBeTrue();

    tick(); 

    expect(requestServiceSpy.sendRequest).toHaveBeenCalled();
    expect(component.isLoading).toBeFalse();
    expect(component.response).toBeDefined();
    expect(component.response?.statusCode).toBe(200);
    expect(requestHistoryServiceSpy.saveHistory).toHaveBeenCalled();
  }));

  it('should switch tabs', () => {
    expect(component.activeRequestTab).toBe('body'); 
    component.activeRequestTab = 'params';
    expect(component.activeRequestTab).toBe('params');
  });

  it('should add and remove headers', () => {
    component.addHeader();
    expect(component.request.httpHeaders?.length).toBe(1);

    component.removeHeader(0);
    expect(component.request.httpHeaders?.length).toBe(0);
  });

  it('should add and remove query params', () => {

    const initialParams = component.queryParams.length;

    component.addQueryParam();
    expect(component.queryParams.length).toBe(initialParams + 1);

    component.removeQueryParam(0);
    expect(component.queryParams.length).toBe(initialParams);
  });

  describe('Integration: Variable Substitution', () => {
    it('should substitute environment variables in the URL before sending', fakeAsync(() => {
      component.request.url = 'https://{{base_url}}/api';
      component.activeVariables = { 'base_url': 'example.org' };

      const mockResponse = {
        status: 200, statusText: 'OK', headers: {},
        body: 'success', timeMs: 10, size: 100
      };
      requestServiceSpy.sendRequest.and.returnValue(Promise.resolve(mockResponse as any));

      component.sendRequest();
      tick();

      expect(requestServiceSpy.sendRequest).toHaveBeenCalledWith(jasmine.objectContaining({
        url: 'https://example.org/api'
      }));
    }));

    it('should substitute inherited variables from parent folders', () => {
      const mockParent = {
        id: 'folder-1',
        title: 'Parent Folder',
        variables: [{ key: 'api_key', value: 'secret-123' }]
      } as any;
      collectionServiceSpy.getParentFolders.and.returnValue([mockParent]);

      (component as any).updateActiveVariables();

      expect(component.activeVariables['api_key']).toBe('secret-123');
    });
  });

  describe('Integration: Script Execution', () => {
    it('should execute pre-request scripts and update variables', async () => {
      requestServiceSpy.sendRequest.and.returnValue(
        Promise.resolve({
          status: 200,
          statusText: 'OK',
          headers: {},
          body: '{}',
          timeMs: 10,
          size: 10,
        } as any),
      );
      component.request.script.preRequest = 'pm.environment.set("test_var", "hello")';
      await component.sendRequest();

      expect(component.activeVariables['test_var']).toBe('hello');
    });

    it('should execute post-request scripts and access response data', async () => {
      const mockResponse = {
        status: 200,
        statusText: 'OK',
        headers: {},
        body: JSON.stringify({ token: 'abc-123' }),
        timeMs: 10,
        size: 100,
      };
      requestServiceSpy.sendRequest.and.returnValue(Promise.resolve(mockResponse as any));

      component.request.script.postRequest = `
        const data = pm.response.json();
        pm.environment.set("auth_token", data.token);
      `;

      await component.sendRequest();

      expect(component.activeVariables['auth_token']).toBe('abc-123');
    });
  });
});
