import { ComponentFixture, TestBed } from '@angular/core/testing';
import { HistoryComponent } from './history.component';
import { RequestHistoryService } from '@core/http/request-history.service';
import { SessionService } from '@core/session/session.service';
import { TabService, TabType } from '@core/tabs/tab.service';
import { of } from 'rxjs';
import { CommonModule } from '@angular/common';
import { HttpMethod } from '@models/request';

describe('HistoryComponent', () => {
  let component: HistoryComponent;
  let fixture: ComponentFixture<HistoryComponent>;

  let requestHistoryServiceSpy: jasmine.SpyObj<RequestHistoryService>;
  let sessionServiceSpy: jasmine.SpyObj<SessionService>;
  let tabServiceSpy: jasmine.SpyObj<TabService>;

  const mockHistory = {
    entries: [
      {
        id: 'hist-1',
        request: { httpMethod: HttpMethod.GET, url: 'https://api.test' } as any,
        response: { statusCode: 200, receivedAt: new Date() } as any,
        createdAt: new Date()
      }
    ]
  };

  beforeEach(async () => {
    requestHistoryServiceSpy = jasmine.createSpyObj('RequestHistoryService', [
      'getHistoryObservable',
      'getSelectedHistoryEntryAsObservable',
      'getEntryById',
      'selectHistoryEntry',
      'saveHistory'
    ]);
    sessionServiceSpy = jasmine.createSpyObj('SessionService', ['get', 'save']);
    tabServiceSpy = jasmine.createSpyObj('TabService', ['getSelectedTab', 'isRequestHistoryEntryTab']);

    requestHistoryServiceSpy.getHistoryObservable.and.returnValue(of(mockHistory));
    requestHistoryServiceSpy.getSelectedHistoryEntryAsObservable.and.returnValue(of(null as any));
    requestHistoryServiceSpy.getEntryById.and.returnValue(mockHistory.entries[0]);

    await TestBed.configureTestingModule({
      imports: [HistoryComponent, CommonModule],
      providers: [
        { provide: RequestHistoryService, useValue: requestHistoryServiceSpy },
        { provide: SessionService, useValue: sessionServiceSpy },
        { provide: TabService, useValue: tabServiceSpy }
      ]
    }).compileComponents();

    fixture = TestBed.createComponent(HistoryComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create and load history', () => {
    expect(component).toBeTruthy();
    expect(component.history).toEqual(mockHistory);
    expect(component.groupedHistory.length).toBeGreaterThan(0);
  });

  it('should group history by date', () => {

    const group = component.groupedHistory[0];
    expect(group.displayLabel).toBe('Today');
    expect(group.entries.length).toBe(1);
  });

  it('should select a history entry', () => {
    const entry = mockHistory.entries[0];
    component.select(entry);

    expect(component.selected).toBe(entry);
    expect(requestHistoryServiceSpy.selectHistoryEntry).toHaveBeenCalled();
  });

  it('should clear history', async () => {
    await component.clearHistory();
    fixture.detectChanges();

    expect(component.groupedHistory.length).toBe(0);
    expect(component.history).toBeNull();
    expect(requestHistoryServiceSpy.saveHistory).toHaveBeenCalledWith({ entries: [] });
  });

  it('should collapse and expand groups', () => {
    const group = component.groupedHistory[0];
    component.toggleGroup(group);
    expect(group.collapsed).toBeTrue();
    expect(sessionServiceSpy.save).toHaveBeenCalled();
  });
});

