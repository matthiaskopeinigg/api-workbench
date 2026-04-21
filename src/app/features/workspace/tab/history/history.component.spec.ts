import { ComponentFixture, TestBed } from '@angular/core/testing';

import { HistoryComponent } from './history.component';
import { RequestHistoryService } from '@core/request-history.service';
import { TabItem, TabType } from '@core/tab.service';
import { HttpMethod } from '@models/request';

describe('HistoryComponent', () => {
  let component: HistoryComponent;
  let fixture: ComponentFixture<HistoryComponent>;

  const mockTab: TabItem = {
    id: 'hist-1',
    title: 'History entry',
    type: TabType.REQUEST_HISTORY_ENTRY,
  };

  const mockEntry = {
    id: 'hist-1',
    request: {
      httpMethod: HttpMethod.GET,
      url: 'https://example.com',
      httpHeaders: [] as { key: string; value: string }[],
      httpParameters: [] as { key: string; value: string }[],
    },
    response: {
      statusCode: 200,
      receivedAt: new Date(),
      headers: [] as { key: string; value: string }[],
      body: '{}',
    },
    createdAt: new Date(),
  };

  beforeEach(async () => {
    const requestHistoryServiceSpy = jasmine.createSpyObj('RequestHistoryService', ['getEntryById']);
    requestHistoryServiceSpy.getEntryById.and.returnValue(mockEntry);

    await TestBed.configureTestingModule({
      imports: [HistoryComponent],
      providers: [{ provide: RequestHistoryService, useValue: requestHistoryServiceSpy }],
    }).compileComponents();

    fixture = TestBed.createComponent(HistoryComponent);
    component = fixture.componentInstance;
    component.tab = mockTab;
    fixture.detectChanges();
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
    expect(component.requestHistoryEntry?.id).toBe('hist-1');
  });
});
