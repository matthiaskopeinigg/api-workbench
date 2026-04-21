import { ComponentFixture, TestBed } from '@angular/core/testing';
import { SidebarComponent } from './sidebar.component';
import { CollectionService } from '@core/collection.service';
import { SessionService } from '@core/session.service';
import { SettingsService } from '@core/settings.service';
import { of } from 'rxjs';
import { CommonModule } from '@angular/common';
import { SidebarItem } from './sidebar-item';

describe('SidebarComponent', () => {
  let component: SidebarComponent;
  let fixture: ComponentFixture<SidebarComponent>;

  let collectionServiceSpy: jasmine.SpyObj<CollectionService>;
  let sessionServiceSpy: jasmine.SpyObj<SessionService>;
  let settingsServiceSpy: jasmine.SpyObj<SettingsService>;

  beforeEach(async () => {
    collectionServiceSpy = jasmine.createSpyObj('CollectionService', ['getCreateNewCollectionObservable']);
    sessionServiceSpy = jasmine.createSpyObj('SessionService', ['get', 'save']);
    settingsServiceSpy = jasmine.createSpyObj('SettingsService', ['getSettings']);

    collectionServiceSpy.getCreateNewCollectionObservable.and.returnValue(of());
    settingsServiceSpy.getSettings.and.returnValue({ ui: { compactMode: false, closeSidebarOnOutsideClick: true } } as any);
    sessionServiceSpy.get.and.returnValue(300);

    await TestBed.configureTestingModule({
      imports: [SidebarComponent, CommonModule],
      providers: [
        { provide: CollectionService, useValue: collectionServiceSpy },
        { provide: SessionService, useValue: sessionServiceSpy },
        { provide: SettingsService, useValue: settingsServiceSpy }
      ]
    }).compileComponents();

    fixture = TestBed.createComponent(SidebarComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('should have initial items', () => {
    expect(component.items.length).toBeGreaterThan(0);
    expect(component.items[0].label).toBe('Collections');
  });

  it('should toggle selection and uncollapse on click', () => {
    const item: SidebarItem = component.items[0];

    component.collapsed = true;

    component.selectItemFromClick(item);

    expect(component.collapsed).toBeFalse();
    expect(component.selectedItem).toBe(item);
    expect(item.active).toBeTrue();
  });

  it('should collapse when clicking the same active item', () => {
    const item: SidebarItem = component.items[0];
    component.selectedItem = item;
    component.collapsed = false;

    component.selectItemFromClick(item);

    expect(component.collapsed).toBeTrue();
    expect(component.selectedItem).toBeNull();
  });

  it('should close secondary sidebar', () => {
    component.collapsed = false;
    component.selectedItem = component.items[0];

    component.closeSecondarySidebar();

    expect(component.collapsed).toBeTrue();
    expect(component.selectedItem).toBeNull();
  });

  it('should handle openSidebarByLabel', () => {
    component.collapsed = true;
    component.openSidebarByLabel('Collections');

    expect(component.collapsed).toBeFalse();
    expect(component.selectedItem?.label).toBe('Collections');
  });
});

