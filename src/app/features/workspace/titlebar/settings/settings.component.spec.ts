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

  const mockSettings = {
    ui: { theme: Theme.DARK },
    requests: {},
    retries: {},
    headers: {},
    ssl: { certificates: [] },
    dns: {},
    proxy: {}
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
      'downloadUpdate',
      'installUpdate',
    ]) as jasmine.SpyObj<UpdateService> & { statusStream: unknown };
    (updateServiceSpy as { statusStream: unknown }).statusStream = of({
      state: 'idle',
      currentVersion: '0.0.0',
      supported: false,
      info: null,
    } as any);

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
});

