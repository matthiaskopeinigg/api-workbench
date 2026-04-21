import { ComponentFixture, TestBed } from '@angular/core/testing';
import { TitlebarComponent } from './titlebar.component';
import { WindowService } from '@core/window.service';
import { CommonModule } from '@angular/common';

describe('TitlebarComponent', () => {
  let component: TitlebarComponent;
  let fixture: ComponentFixture<TitlebarComponent>;

  let windowServiceSpy: jasmine.SpyObj<WindowService>;

  beforeEach(async () => {
    windowServiceSpy = jasmine.createSpyObj('WindowService', ['minimize', 'maximize', 'close']);

    await TestBed.configureTestingModule({
      imports: [TitlebarComponent, CommonModule],
      providers: [
        { provide: WindowService, useValue: windowServiceSpy }
      ]
    }).compileComponents();

    fixture = TestBed.createComponent(TitlebarComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('should toggle settings visibility', () => {
    expect(component.showSettings).toBeFalse();
    component.toggleSettingsPopup();
    expect(component.showSettings).toBeTrue();
    component.toggleSettingsPopup();
    expect(component.showSettings).toBeFalse();
  });

  it('should minimize window', () => {
    component.minimize();
    expect(windowServiceSpy.minimize).toHaveBeenCalled();
  });

  it('should maximize window', () => {
    component.maximize();
    expect(windowServiceSpy.maximize).toHaveBeenCalled();
  });

  it('should close window', () => {
    component.close();
    expect(windowServiceSpy.close).toHaveBeenCalled();
  });
});

