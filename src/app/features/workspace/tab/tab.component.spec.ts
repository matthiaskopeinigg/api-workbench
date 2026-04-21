import { ComponentFixture, TestBed } from '@angular/core/testing';

import { TabComponent } from './tab.component';
import { TabItem, TabType } from '@core/tab.service';

describe('TabComponent', () => {
  let component: TabComponent;
  let fixture: ComponentFixture<TabComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [TabComponent]
    })
    .compileComponents();

    fixture = TestBed.createComponent(TabComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
    expect(component.tabs).toEqual([]);
    expect(component.selectedTabIndex).toBe(0);
  });

  it('trackByTabId should return the tab id for stable ngFor identity', () => {
    const tab: TabItem = { id: 'tab-42', title: 'x', type: TabType.REQUEST };
    expect(component.trackByTabId(0, tab)).toBe('tab-42');
  });

  it('onDragEnd should reset drag indices and remove the body dragging class', () => {
    component.draggedIndex = 2;
    component.overIndex = 3;
    document.body.classList.add('aw-dragging');

    component.onDragEnd();

    expect(component.draggedIndex).toBeNull();
    expect(component.overIndex).toBeNull();
    expect(document.body.classList.contains('aw-dragging')).toBeFalse();
  });

  it('onDrop should prevent default and clear the drag state', () => {
    component.draggedIndex = 1;
    document.body.classList.add('aw-dragging');

    const evt = new DragEvent('drop', { bubbles: true, cancelable: true });
    const spy = spyOn(evt, 'preventDefault');

    component.onDrop(evt);

    expect(spy).toHaveBeenCalled();
    expect(component.draggedIndex).toBeNull();
    expect(document.body.classList.contains('aw-dragging')).toBeFalse();
  });

  describe('onDragOver reordering', () => {
    const mkTab = (id: string): TabItem => ({ id, title: id, type: TabType.REQUEST });

    const makeDragOverEvent = (clientX: number): DragEvent => {
      const host = document.createElement('div');
      host.getBoundingClientRect = () => ({
        left: 100, right: 200, top: 0, bottom: 40,
        width: 100, height: 40, x: 100, y: 0,
        toJSON: () => ({})
      } as DOMRect);

      return {
        preventDefault: () => { },
        currentTarget: host,
        clientX,
        dataTransfer: { dropEffect: '' } as any,
      } as unknown as DragEvent;
    };

    it('keeps the previously selected tab selected after another tab is dragged past it', () => {
      component.tabs = [mkTab('A'), mkTab('B'), mkTab('C'), mkTab('D')];
      component.selectedTabIndex = 0;
      component.draggedIndex = 2;

      component.onDragOver(makeDragOverEvent(110), 0);

      expect(component.tabs.map(t => t.id)).toEqual(['C', 'A', 'B', 'D']);
      expect(component.selectedTabIndex).toBe(1);
    });

    it('keeps the selected tab selected when the selected tab itself is the one being dragged', () => {
      component.tabs = [mkTab('A'), mkTab('B'), mkTab('C'), mkTab('D')];
      component.selectedTabIndex = 1;
      component.draggedIndex = 1;

      component.onDragOver(makeDragOverEvent(190), 2);

      expect(component.tabs.map(t => t.id)).toEqual(['A', 'C', 'B', 'D']);
      expect(component.selectedTabIndex).toBe(2);
      expect(component.tabs[component.selectedTabIndex].id).toBe('B');
    });
  });
});

