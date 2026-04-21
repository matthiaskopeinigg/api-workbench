import { TestBed } from '@angular/core/testing';
import { AppComponent } from './app.component';
import { CollectionService } from '@core/collection.service';
import { CommandSeedsService } from '@core/command-seeds.service';
import { EnvironmentsService } from '@core/environments.service';
import { RequestHistoryService } from '@core/request-history.service';
import { SessionService } from '@core/session.service';
import { SettingsService } from '@core/settings.service';
import { TabService } from '@core/tab.service';
import { ThemeService } from '@core/theme.service';
import { UpdateService } from '@core/update.service';
import { ViewStateService } from '@core/view-state.service';

describe('AppComponent', () => {
  let collectionSpy: jasmine.SpyObj<CollectionService>;
  let envSpy: jasmine.SpyObj<EnvironmentsService>;
  let historySpy: jasmine.SpyObj<RequestHistoryService>;
  let sessionSpy: jasmine.SpyObj<SessionService>;
  let settingsSpy: jasmine.SpyObj<SettingsService>;
  let tabSpy: jasmine.SpyObj<TabService>;
  let themeSpy: jasmine.SpyObj<ThemeService>;
  let updateSpy: jasmine.SpyObj<UpdateService>;
  let viewStateSpy: jasmine.SpyObj<ViewStateService>;
  let commandSeedsSpy: jasmine.SpyObj<CommandSeedsService>;

  beforeEach(async () => {
    collectionSpy = jasmine.createSpyObj('CollectionService', ['loadCollections', 'flushPendingSaves']);
    envSpy = jasmine.createSpyObj('EnvironmentsService', ['loadEnvironments', 'flushPendingSaves']);
    historySpy = jasmine.createSpyObj('RequestHistoryService', ['loadHistory']);
    sessionSpy = jasmine.createSpyObj('SessionService', ['load']);
    settingsSpy = jasmine.createSpyObj('SettingsService', ['loadSettings']);
    tabSpy = jasmine.createSpyObj('TabService', ['loadSettings']);
    themeSpy = jasmine.createSpyObj('ThemeService', ['loadTheme']);
    updateSpy = jasmine.createSpyObj('UpdateService', ['init']);
    viewStateSpy = jasmine.createSpyObj('ViewStateService', ['load']);
    commandSeedsSpy = jasmine.createSpyObj('CommandSeedsService', ['register']);

    [
      collectionSpy.loadCollections,
      collectionSpy.flushPendingSaves,
      envSpy.loadEnvironments,
      envSpy.flushPendingSaves,
      historySpy.loadHistory,
      sessionSpy.load,
      settingsSpy.loadSettings,
      tabSpy.loadSettings,
      themeSpy.loadTheme,
      viewStateSpy.load,
    ].forEach(s => s.and.returnValue(Promise.resolve()));

    await TestBed.configureTestingModule({
      imports: [AppComponent],
      providers: [
        { provide: CollectionService, useValue: collectionSpy },
        { provide: EnvironmentsService, useValue: envSpy },
        { provide: RequestHistoryService, useValue: historySpy },
        { provide: SessionService, useValue: sessionSpy },
        { provide: SettingsService, useValue: settingsSpy },
        { provide: TabService, useValue: tabSpy },
        { provide: ThemeService, useValue: themeSpy },
        { provide: UpdateService, useValue: updateSpy },
        { provide: ViewStateService, useValue: viewStateSpy },
        { provide: CommandSeedsService, useValue: commandSeedsSpy },
      ]
    }).compileComponents();
  });

  it('should create the app', () => {
    const fixture = TestBed.createComponent(AppComponent);
    const app = fixture.componentInstance;
    expect(app).toBeTruthy();
    expect(app.isReady).toBeFalse();
    expect(app.initError).toBeNull();
  });

  it('ngOnInit should flip isReady once all bootstrap promises resolve', async () => {
    const fixture = TestBed.createComponent(AppComponent);
    const app = fixture.componentInstance;

    await app.ngOnInit();

    expect(app.isReady).toBeTrue();
    expect(app.initError).toBeNull();
    expect(collectionSpy.loadCollections).toHaveBeenCalled();
    expect(envSpy.loadEnvironments).toHaveBeenCalled();
    expect(historySpy.loadHistory).toHaveBeenCalled();
    expect(themeSpy.loadTheme).toHaveBeenCalled();
  });

  it('ngOnInit should surface an initError when a bootstrap step rejects', async () => {
    collectionSpy.loadCollections.and.returnValue(Promise.reject(new Error('boom')));

    const fixture = TestBed.createComponent(AppComponent);
    const app = fixture.componentInstance;

    await app.ngOnInit();

    expect(app.isReady).toBeFalse();
    expect(app.initError).toBe('boom');
  });

  it('retryInit should reset state and re-run the bootstrap', async () => {
    collectionSpy.loadCollections.and.returnValue(Promise.reject(new Error('fail')));

    const fixture = TestBed.createComponent(AppComponent);
    const app = fixture.componentInstance;
    await app.ngOnInit();
    expect(app.initError).toBe('fail');

    collectionSpy.loadCollections.and.returnValue(Promise.resolve());
    await app.retryInit();

    expect(app.initError).toBeNull();
    expect(app.isReady).toBeTrue();
  });

  it('onBeforeUnload should flush both service persistence queues in parallel', async () => {
    const fixture = TestBed.createComponent(AppComponent);
    const app = fixture.componentInstance;

    await app.onBeforeUnload();

    expect(collectionSpy.flushPendingSaves).toHaveBeenCalled();
    expect(envSpy.flushPendingSaves).toHaveBeenCalled();
  });
});
