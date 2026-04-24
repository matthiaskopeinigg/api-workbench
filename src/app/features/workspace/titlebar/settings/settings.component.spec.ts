import { ComponentFixture, TestBed, fakeAsync, tick, flushMicrotasks } from '@angular/core/testing';
import { SettingsComponent } from './settings.component';
import { FormBuilder, ReactiveFormsModule } from '@angular/forms';
import { SettingsService } from '@core/settings/settings.service';
import { ThemeService } from '@core/settings/theme.service';
import { FileDialogService } from '@core/platform/file-dialog.service';
import { CollectionService } from '@core/collection/collection.service';
import { ImportService } from '@core/import-pipeline/import.service';
import { BatchImportDialogService } from '@core/import-pipeline/batch-import-dialog.service';
import type { BatchImportResult } from '@core/import-pipeline/import-batch.service';
import { UpdateService } from '@core/platform/update.service';
import { EnvironmentsService } from '@core/environments/environments.service';
import { ConfirmDialogService } from '@core/ui/confirm-dialog.service';
import { SessionService } from '@core/session/session.service';
import { Theme } from '@models/settings';
import { of, Subject } from 'rxjs';
import { CommonModule } from '@angular/common';

describe('SettingsComponent', () => {
  let component: SettingsComponent;
  let fixture: ComponentFixture<SettingsComponent>;

  let settingsServiceSpy: jasmine.SpyObj<SettingsService>;
  let themeServiceSpy: jasmine.SpyObj<ThemeService>;
  let fileDialogServiceSpy: jasmine.SpyObj<FileDialogService>;
  let collectionServiceSpy: jasmine.SpyObj<CollectionService>;
  let importServiceSpy: jasmine.SpyObj<ImportService>;
  let batchImportDialogSpy: jasmine.SpyObj<BatchImportDialogService> & {
    finished$: Subject<BatchImportResult | null>;
  };
  let updateServiceSpy: jasmine.SpyObj<UpdateService> & { statusStream: unknown };
  let environmentsServiceSpy: jasmine.SpyObj<EnvironmentsService>;
  let sessionServiceSpy: jasmine.SpyObj<SessionService>;
  let confirmDialogSpy: jasmine.SpyObj<ConfirmDialogService>;

  const mockSettings = {
    ui: { theme: Theme.DARK },
    requests: {},
    retries: {},
    headers: {},
    ssl: { certificates: [] },
    dns: {},
    proxy: {},
    logging: {},
  };

  beforeEach(async () => {
    settingsServiceSpy = jasmine.createSpyObj('SettingsService', ['getSettings', 'saveSettings']);
    themeServiceSpy = jasmine.createSpyObj('ThemeService', ['setTheme']);
    fileDialogServiceSpy = jasmine.createSpyObj('FileDialogService', [
      'openFile',
      'saveFile',
      'openFiles',
      'readImportFolder',
      'openDirectoryForExport',
      'writeFilesToDirectory',
    ]);
    collectionServiceSpy = jasmine.createSpyObj('CollectionService', ['getCollections', 'saveCollections', 'deleteAllCollections']);
    importServiceSpy = jasmine.createSpyObj('ImportService', ['importPostmanCollection', 'importOpenApi']);
    const finished$ = new Subject<BatchImportResult | null>();
    batchImportDialogSpy = jasmine.createSpyObj('BatchImportDialogService', [
      'startPreview',
    ]) as jasmine.SpyObj<BatchImportDialogService> & {
      finished$: Subject<BatchImportResult | null>;
    };
    batchImportDialogSpy.finished$ = finished$;
    updateServiceSpy = jasmine.createSpyObj('UpdateService', [
      'checkForUpdates',
      'downloadAndInstall',
      'installUpdate',
    ]) as jasmine.SpyObj<UpdateService> & { statusStream: unknown };
    (updateServiceSpy as { statusStream: unknown }).statusStream = of({
      state: 'idle',
      currentVersion: '0.0.0',
      supported: false,
      info: null,
    } as any);
    environmentsServiceSpy = jasmine.createSpyObj('EnvironmentsService', [
      'loadEnvironments',
      'getActiveContext',
      'getActiveContextAsObservable',
    ]);
    environmentsServiceSpy.loadEnvironments.and.resolveTo();
    environmentsServiceSpy.getActiveContext.and.returnValue(null);
    environmentsServiceSpy.getActiveContextAsObservable.and.returnValue(of(null));

    sessionServiceSpy = jasmine.createSpyObj('SessionService', ['load', 'get']);
    sessionServiceSpy.load.and.resolveTo();
    sessionServiceSpy.get.and.returnValue(null);

    confirmDialogSpy = jasmine.createSpyObj('ConfirmDialogService', ['confirm', 'alert']);
    confirmDialogSpy.confirm.and.resolveTo(true);
    confirmDialogSpy.alert.and.resolveTo();

    settingsServiceSpy.getSettings.and.returnValue(mockSettings as any);
    collectionServiceSpy.getCollections.and.returnValue([]);

    await TestBed.configureTestingModule({
      imports: [SettingsComponent, CommonModule, ReactiveFormsModule],
      providers: [
        FormBuilder,
        { provide: SettingsService, useValue: settingsServiceSpy },
        { provide: ThemeService, useValue: themeServiceSpy },
        { provide: FileDialogService, useValue: fileDialogServiceSpy },
        { provide: CollectionService, useValue: collectionServiceSpy },
        { provide: ImportService, useValue: importServiceSpy },
        { provide: BatchImportDialogService, useValue: batchImportDialogSpy },
        { provide: UpdateService, useValue: updateServiceSpy },
        { provide: EnvironmentsService, useValue: environmentsServiceSpy },
        { provide: SessionService, useValue: sessionServiceSpy },
        { provide: ConfirmDialogService, useValue: confirmDialogSpy },
      ]
    }).compileComponents();

    fixture = TestBed.createComponent(SettingsComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  });

  it('should create and load settings', () => {
    expect(component).toBeTruthy();
    expect(settingsServiceSpy.getSettings).toHaveBeenCalled();
    expect(component.settingsForm).toBeDefined();
    expect(component.settingsForm.get('ui.theme')?.value).toBe(Theme.DARK);
  });

  it('should update theme when form changes', fakeAsync(() => {
    const themeControl = component.settingsForm.get('ui.theme');
    themeControl?.setValue(Theme.LIGHT);
    flushMicrotasks();

    expect(themeServiceSpy.setTheme).toHaveBeenCalledWith(Theme.LIGHT, false);

    tick(300); 
    fixture.detectChanges();

    expect(settingsServiceSpy.saveSettings).toHaveBeenCalled();
  }));

  it('should switch tabs', () => {
    component.selectTab('proxy');
    expect(component.selectedTab).toBe('proxy');
  });

  it('should add certificate', () => {
    const certs = component.certificates;
    expect(certs.length).toBe(0);

    component.hostnameControl.setValue('example.com');
    component.saveCertificate();

    expect(certs.length).toBe(1);
    expect(certs.at(0).value.hostname).toBe('example.com');
  });

  it('should remove certificate', () => {
    component.hostnameControl.setValue('example.com');
    component.saveCertificate();

    component.removeCertificate(0);
    expect(component.certificates.length).toBe(0);
  });

  it('updateStatusMessage should say no new version when release has no update channel file', () => {
    component.updaterStatus = {
      state: 'not-available',
      currentVersion: '1.0.0-beta.18',
      supported: true,
      info: { noReleaseChannel: true },
    } as any;
    expect(component.updateStatusMessage).toBe('No new version found.');
  });

  it('updateStatusMessage should say latest version for normal not-available', () => {
    component.updaterStatus = {
      state: 'not-available',
      currentVersion: '1.0.0-beta.17',
      supported: true,
      info: { version: '1.0.0-beta.17' },
    } as any;
    expect(component.updateStatusMessage).toBe('You\u2019re on the latest version (1.0.0-beta.17).');
  });

  it('updateStatusMessage should describe development idle when devReadOnly', () => {
    component.updaterStatus = {
      state: 'idle',
      currentVersion: '1.0.0-beta.18',
      supported: false,
      info: { devReadOnly: true },
    } as any;
    expect(component.updateStatusMessage).toContain('development');
    expect(component.updateStatusMessage).toContain('GitHub');
  });

  it('updateStatusMessage should mention GitHub when checking in unsupported build', () => {
    component.updaterStatus = {
      state: 'checking',
      currentVersion: '1.0.0-beta.18',
      supported: false,
      info: null,
    } as any;
    expect(component.updateStatusMessage).toContain('GitHub');
  });

  it('updateStatusMessage should describe dev preview when newer exists on GitHub', () => {
    component.updaterStatus = {
      state: 'available',
      currentVersion: '1.0.0-beta.1',
      supported: false,
      info: { version: '9.9.9', devPreviewOnly: true },
    } as any;
    expect(component.updateStatusMessage).toContain('GitHub');
    expect(component.updateStatusMessage).toContain('9.9.9');
  });
});

