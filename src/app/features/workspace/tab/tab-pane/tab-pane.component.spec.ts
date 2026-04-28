import { ComponentFixture, TestBed } from '@angular/core/testing';
import { TabPaneComponent } from './tab-pane.component';
import { TabItem, TabService, TabType } from '@core/tabs/tab.service';

describe('TabPaneComponent', () => {
  let component: TabPaneComponent;
  let fixture: ComponentFixture<TabPaneComponent>;
  let tabServiceSpy: jasmine.SpyObj<TabService>;

  beforeEach(async () => {
    tabServiceSpy = jasmine.createSpyObj('TabService', [
      'isEnvironmentTab',
      'isRequestHistoryEntryTab',
      'isRequestTab',
      'isFolderTab',
      'isWebSocketTab',
      'isMockServerTab',
      'isLoadTestTab',
      'isCaptureTab',
    ]);
    tabServiceSpy.isRequestTab.and.returnValue(true);
    tabServiceSpy.isEnvironmentTab.and.returnValue(false);
    tabServiceSpy.isRequestHistoryEntryTab.and.returnValue(false);
    tabServiceSpy.isFolderTab.and.returnValue(false);
    tabServiceSpy.isWebSocketTab.and.returnValue(false);
    tabServiceSpy.isMockServerTab.and.returnValue(false);
    tabServiceSpy.isLoadTestTab.and.returnValue(false);
    tabServiceSpy.isCaptureTab.and.returnValue(false);

    await TestBed.configureTestingModule({
      imports: [TabPaneComponent],
      providers: [{ provide: TabService, useValue: tabServiceSpy }],
    }).compileComponents();

    fixture = TestBed.createComponent(TabPaneComponent);
    component = fixture.componentInstance;
    component.paneId = 'primary';
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('trackByTabId should return the tab id for stable ngFor identity', () => {
    const tab: TabItem = { id: 'tab-42', title: 'x', type: TabType.REQUEST };
    expect(component.trackByTabId(0, tab)).toBe('tab-42');
  });

  it('onDragEnd should reset drag indices and remove the body dragging class', () => {
    component.draggedIndex = 2;
    document.body.classList.add('aw-dragging');

    component.onDragEnd();

    expect(component.draggedIndex).toBeNull();
    expect(document.body.classList.contains('aw-dragging')).toBeFalse();
  });

  it('onDragEnd should remove the tab drag ghost node from the document', () => {
    const ghost = document.createElement('div');
    ghost.className = 'aw-drag-ghost is-tab';
    document.body.appendChild(ghost);
    (component as unknown as { tabDragGhostEl: HTMLElement }).tabDragGhostEl = ghost;

    component.onDragEnd();

    expect(document.body.contains(ghost)).toBeFalse();
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
      host.getBoundingClientRect = () =>
        ({
          left: 100,
          right: 200,
          top: 0,
          bottom: 40,
          width: 100,
          height: 40,
          x: 100,
          y: 0,
          toJSON: () => ({}),
        }) as DOMRect;

      return {
        preventDefault: () => {},
        currentTarget: host,
        clientX,
        dataTransfer: { dropEffect: '' } as any,
      } as unknown as DragEvent;
    };

    it('keeps the previously selected tab selected after another tab is dragged past it', () => {
      component.tabs = [mkTab('A'), mkTab('B'), mkTab('C'), mkTab('D')];
      component.selectedTabIndex = 0;
      component.draggedIndex = 2;
      spyOn(component.tabsReorder, 'emit');

      component.onDragOver(makeDragOverEvent(110), 0);

      expect(component.tabsReorder.emit).toHaveBeenCalled();
      const arg = (component.tabsReorder.emit as jasmine.Spy).calls.mostRecent().args[0];
      expect(arg.tabs.map((t: TabItem) => t.id)).toEqual(['C', 'A', 'B', 'D']);
      expect(arg.selectedTabIndex).toBe(1);
    });

    it('keeps the selected tab selected when the selected tab itself is the one being dragged', () => {
      component.tabs = [mkTab('A'), mkTab('B'), mkTab('C'), mkTab('D')];
      component.selectedTabIndex = 1;
      component.draggedIndex = 1;
      spyOn(component.tabsReorder, 'emit');

      component.onDragOver(makeDragOverEvent(190), 2);

      const arg = (component.tabsReorder.emit as jasmine.Spy).calls.mostRecent().args[0];
      expect(arg.tabs.map((t: TabItem) => t.id)).toEqual(['A', 'C', 'B', 'D']);
      expect(arg.selectedTabIndex).toBe(2);
      expect(arg.tabs[arg.selectedTabIndex].id).toBe('B');
    });
  });
});
