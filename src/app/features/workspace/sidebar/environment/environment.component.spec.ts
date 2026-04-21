import { ComponentFixture, TestBed } from '@angular/core/testing';
import { EnvironmentComponent } from './environment.component';
import { EnvironmentsService } from '@core/environments.service';
import { TabService, TabType } from '@core/tab.service';
import { of } from 'rxjs';
import { CommonModule } from '@angular/common';

describe('EnvironmentComponent', () => {
  let component: EnvironmentComponent;
  let fixture: ComponentFixture<EnvironmentComponent>;

  let environmentsServiceSpy: jasmine.SpyObj<EnvironmentsService>;
  let tabServiceSpy: jasmine.SpyObj<TabService>;

  const mockEnvs = [
    { id: '1', title: 'Dev', order: 0, variables: [] },
    { id: '2', title: 'Prod', order: 1, variables: [] }
  ];

  beforeEach(async () => {
    environmentsServiceSpy = jasmine.createSpyObj('EnvironmentsService', [
      'getEnvironmentsObservable',
      'getActiveContextAsObservable',
      'saveEnvironments',
      'getEnvironmentById',
      'selectEnvironment',
      'getSelectedEnvironmentAsObservable'
    ]);
    tabServiceSpy = jasmine.createSpyObj('TabService', ['getSelectedTab', 'isEnvironmentTab']);

    environmentsServiceSpy.getEnvironmentsObservable.and.returnValue(of(mockEnvs));
    environmentsServiceSpy.getSelectedEnvironmentAsObservable.and.returnValue(of(null as any));
    environmentsServiceSpy.getActiveContextAsObservable.and.returnValue(of(null as any)); 

    await TestBed.configureTestingModule({
      imports: [EnvironmentComponent, CommonModule],
      providers: [
        { provide: EnvironmentsService, useValue: environmentsServiceSpy },
        { provide: TabService, useValue: tabServiceSpy }
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

  it('should delete environment', () => {
    const initialLength = component.environments.length;
    const devIndex = component.environments.findIndex(e => e.title === 'Dev');
    component.deleteEnvironment(devIndex >= 0 ? devIndex : 0);

    expect(component.environments.length).toBe(initialLength - 1);
    expect(component.environments.every(e => e.title !== 'Dev')).toBeTrue();
    expect(environmentsServiceSpy.saveEnvironments).toHaveBeenCalled();
  });

  it('should select environment', () => {
    const env = mockEnvs[1];
    component.selectEnvironment(env);

    expect(component.selectedEnv).toBe(env);
    expect(environmentsServiceSpy.selectEnvironment).toHaveBeenCalledWith({
      id: env.id,
      title: env.title,
      type: TabType.ENVIRONMENT
    });
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

