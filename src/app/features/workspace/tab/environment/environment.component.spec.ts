import { ComponentFixture, TestBed } from '@angular/core/testing';

import { EnvironmentComponent } from './environment.component';
import { EnvironmentsService } from '@core/environments.service';
import { TabItem, TabType } from '@core/tab.service';

describe('EnvironmentComponent', () => {
  let component: EnvironmentComponent;
  let fixture: ComponentFixture<EnvironmentComponent>;

  const mockTab: TabItem = {
    id: 'env-1',
    title: 'Dev',
    type: TabType.ENVIRONMENT,
  };

  beforeEach(async () => {
    const environmentsServiceSpy = jasmine.createSpyObj('EnvironmentsService', [
      'getEnvironmentById',
    ]);
    environmentsServiceSpy.getEnvironmentById.and.returnValue({
      id: 'env-1',
      title: 'Dev',
      order: 0,
      variables: [],
    });

    await TestBed.configureTestingModule({
      imports: [EnvironmentComponent],
      providers: [{ provide: EnvironmentsService, useValue: environmentsServiceSpy }],
    }).compileComponents();

    fixture = TestBed.createComponent(EnvironmentComponent);
    component = fixture.componentInstance;
    component.tab = mockTab;
    fixture.detectChanges();
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
    expect(component.environment?.id).toBe('env-1');
  });
});
