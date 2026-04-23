import { ComponentFixture, TestBed } from '@angular/core/testing';
import { SimpleChange } from '@angular/core';
import { ResponseDiffComponent } from './response-diff.component';
import { ResponseHistoryService } from '@core/http/response-history.service';
import type { ResponseHistoryListItem } from '@models/electron';

describe('ResponseDiffComponent', () => {
  let fixture: ComponentFixture<ResponseDiffComponent>;
  let component: ResponseDiffComponent;
  let historySpy: jasmine.SpyObj<ResponseHistoryService>;

  const list: ResponseHistoryListItem[] = [
    { id: 2, requestId: 'r1', receivedAt: 1000, statusCode: 200, statusText: 'OK', timeMs: 40, size: 100, httpVersion: '1.1', contentType: 'application/json', isBinary: false },
    { id: 1, requestId: 'r1', receivedAt:  900, statusCode: 200, statusText: 'OK', timeMs: 50, size:  90, httpVersion: '1.1', contentType: 'application/json', isBinary: false },
  ];

  beforeEach(async () => {
    historySpy = jasmine.createSpyObj('ResponseHistoryService', ['list', 'get']);
    historySpy.list.and.resolveTo(list);
    historySpy.get.and.resolveTo({ id: 1, body: '{"a":1}' } as any);

    await TestBed.configureTestingModule({
      imports: [ResponseDiffComponent],
      providers: [{ provide: ResponseHistoryService, useValue: historySpy }],
    }).compileComponents();

    fixture = TestBed.createComponent(ResponseDiffComponent);
    component = fixture.componentInstance;
  });

  it('loads the history and picks the second-newest entry when available', async () => {
    component.requestId = 'r1';
    component.current = { body: '{"a":2}', contentType: 'application/json' } as any;
    component.ngOnChanges({
      requestId: new SimpleChange(null, 'r1', true),
      current:   new SimpleChange(null, component.current, true),
    });

    await fixture.whenStable();
    expect(historySpy.list).toHaveBeenCalledWith('r1', 25);
    expect(component.selectedId).toBe(1);
    expect(component.compareBody).toBe('{"a":1}');
  });

  it('falls back to the only entry when the history has a single item', async () => {
    historySpy.list.and.resolveTo([list[0]]);
    component.requestId = 'r1';
    component.ngOnChanges({ requestId: new SimpleChange(null, 'r1', true) });
    await fixture.whenStable();
    expect(component.selectedId).toBe(2);
  });

  it('clears the selection when the history is empty', async () => {
    historySpy.list.and.resolveTo([]);
    component.requestId = 'r1';
    component.ngOnChanges({ requestId: new SimpleChange(null, 'r1', true) });
    await fixture.whenStable();
    expect(component.selectedId).toBeNull();
    expect(component.history.length).toBe(0);
  });

  it('recomputes the diff summary (added / removed / equal) when current body changes', async () => {
    component.compareBody = '{"a":1}';
    component.current = { body: '{"a":1,"b":2}', contentType: 'application/json' } as any;
    component.ngOnChanges({ current: new SimpleChange(null, component.current, true) });
    expect(component.summary.added + component.summary.removed + component.summary.equal).toBeGreaterThan(0);
  });

  it('re-normalises the diff when onNormalizeChange is called', () => {
    component.compareBody = '{ "a": 1 }';
    component.current = { body: '{"a":1}', contentType: 'application/json' } as any;

    component.onNormalizeChange(true);
    const normalizedEqual = component.summary.equal;

    component.onNormalizeChange(false);
    expect(component.summary.added + component.summary.removed).toBeGreaterThanOrEqual(0);
    expect(component.normalize).toBeFalse();
    expect(normalizedEqual).toBeGreaterThan(0);
  });

  it('formats timestamps to locale strings; empty / bogus values stay safe', () => {
    expect(component.formatTimestamp(null)).toBe('');
    expect(component.formatTimestamp(0)).toBe('');
    const now = Date.now();
    expect(component.formatTimestamp(now)).toContain(String(new Date(now).getFullYear()));
  });

  it('onSelectChange loads the chosen entry body', async () => {
    historySpy.get.and.resolveTo({ id: 2, body: '{"a":3}' } as any);
    await component.onSelectChange(2);
    expect(historySpy.get).toHaveBeenCalledWith(2);
    expect(component.compareBody).toBe('{"a":3}');
  });
});
