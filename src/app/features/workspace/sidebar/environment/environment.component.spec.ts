import { ComponentFixture, TestBed } from '@angular/core/testing';
import { EnvironmentComponent } from './environment.component';
import { EnvironmentsService } from '@core/environments/environments.service';
import { TabService, TabType } from '@core/tabs/tab.service';
import { ConfirmDialogService } from '@core/ui/confirm-dialog.service';
import { of } from 'rxjs';
import { CommonModule } from '@angular/common';

describe('EnvironmentComponent', () => {
  let component: EnvironmentComponent;
  let fixture: ComponentFixture<EnvironmentComponent>;

  let environmentsServiceSpy: jasmine.SpyObj<EnvironmentsService>;
  let tabServiceSpy: jasmine.SpyObj<TabService>;
  let confirmDialogSpy: jasmine.SpyObj<ConfirmDialogService>;

  function freshMockEnvs(): { id: string; title: string; order: number; variables: never[] }[] {
    return [
      { id: '1', title: 'Dev', order: 0, variables: [] },
      { id: '2', title: 'Prod', order: 1, variables: [] },
    ];
  }

  beforeEach(async () => {
    environmentsServiceSpy = jasmine.createSpyObj('EnvironmentsService', [
      'getEnvironmentsObservable',
      'getActiveContextAsObservable',
      'saveEnvironments',
      'getEnvironmentById',
      'selectEnvironment',
      'getSelectedEnvironmentAsObservable',
      'triggerEnvironmentDeleted',
      'emitEnvironmentTitleUpdated',
    ]);
    tabServiceSpy = jasmine.createSpyObj('TabService', ['getSelectedTab', 'isEnvironmentTab']);
    confirmDialogSpy = jasmine.createSpyObj('ConfirmDialogService', ['confirm']);
    confirmDialogSpy.confirm.and.returnValue(Promise.resolve(true));

    environmentsServiceSpy.getEnvironmentsObservable.and.returnValue(
      of(freshMockEnvs().map((e) => ({ ...e, variables: [...e.variables] }))),
    );
    environmentsServiceSpy.getSelectedEnvironmentAsObservable.and.returnValue(of(null as any));
    environmentsServiceSpy.getActiveContextAsObservable.and.returnValue(of(null as any)); 

    await TestBed.configureTestingModule({
      imports: [EnvironmentComponent, CommonModule],
      providers: [
        { provide: EnvironmentsService, useValue: environmentsServiceSpy },
        { provide: TabService, useValue: tabServiceSpy },
        { provide: ConfirmDialogService, useValue: confirmDialogSpy },
      ]
    }).compileComponents();

    fixture = TestBed.createComponent(EnvironmentComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  });

  it('should create and load environments', () => {
    expect(component).toBeTruthy();
    expect(component.environments.length).toBe(2);
    const titles = component.environments.map(e => e.title).sort();
    expect(titles).toEqual(['Dev', 'Prod']);
  });

  it('should add new environment', () => {
    const initialLength = component.environments.length;
    component.newEnvTitle = 'Staging';
    component.addEnvironment();

    expect(component.environments.length).toBe(initialLength + 1);
    expect(component.environments[component.environments.length - 1].title).toBe('Staging');
    expect(environmentsServiceSpy.saveEnvironments).toHaveBeenCalled();
  });

  it('should not add empty environment', () => {
    const initialLength = component.environments.length;
    component.newEnvTitle = '   ';
    component.addEnvironment();
    expect(component.environments.length).toBe(initialLength);
  });

  it('should delete environment', async () => {
    const initialLength = component.environments.length;
    const devIndex = component.environments.findIndex(e => e.title === 'Dev');
    await component.deleteEnvironment(devIndex >= 0 ? devIndex : 0);

    expect(component.environments.length).toBe(initialLength - 1);
    expect(component.environments.every(e => e.title !== 'Dev')).toBeTrue();
    expect(environmentsServiceSpy.saveEnvironments).toHaveBeenCalled();
    expect(environmentsServiceSpy.triggerEnvironmentDeleted).toHaveBeenCalled();
  });

  it('should select environment', () => {
    const env = component.environments.find((e) => e.id === '2')!;
    component.selectEnvironment(env);

    expect(component.selectedEnv).toBe(env);
    expect(environmentsServiceSpy.selectEnvironment).toHaveBeenCalledWith({
      id: env.id,
      title: env.title,
      type: TabType.ENVIRONMENT
    });
  });

  it('should rename environment and notify tab titles', async () => {
    const env = component.environments.find((e) => e.id === '1');
    expect(env).toBeTruthy();
    component.startRenameEnvironment(env!.id);
    fixture.detectChanges();
    await component.finishRenameEnvironment(env!, 'NewDev');

    expect(env!.title).toBe('NewDev');
    expect(environmentsServiceSpy.saveEnvironments).toHaveBeenCalled();
    expect(environmentsServiceSpy.emitEnvironmentTitleUpdated).toHaveBeenCalledWith('1', 'NewDev');
  });

  it('should handle drag and drop', () => {
    const before = component.environments.map(e => e.title);
    expect(before.length).toBe(2);

    component.onDragStart(0);
    component.onDragOver({ preventDefault: () => { } } as any, 1);
    component.onDrop();

    const after = component.environments.map(e => e.title);
    expect(after[0]).toBe(before[1]);
    expect(after[1]).toBe(before[0]);
    expect(environmentsServiceSpy.saveEnvironments).toHaveBeenCalled();
  });
});

