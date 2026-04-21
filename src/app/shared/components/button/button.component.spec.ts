import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ButtonComponent } from './button.component';

describe('ButtonComponent', () => {
  let component: ButtonComponent;
  let fixture: ComponentFixture<ButtonComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ButtonComponent]
    }).compileComponents();

    fixture = TestBed.createComponent(ButtonComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create with default primary/md variant', () => {
    expect(component).toBeTruthy();
    expect(component.variant).toBe('primary');
    expect(component.size).toBe('md');
    expect(component.type).toBe('button');
    expect(component.disabled).toBeFalse();
    expect(component.loading).toBeFalse();

    const btn: HTMLButtonElement = fixture.nativeElement.querySelector('button');
    expect(btn.className).toContain('primary');
    expect(btn.className).toContain('md');
    expect(btn.type).toBe('button');
  });

  it('should apply variant and size inputs to the rendered button class', () => {
    component.variant = 'danger';
    component.size = 'lg';
    fixture.detectChanges();
    const btn: HTMLButtonElement = fixture.nativeElement.querySelector('button');
    expect(btn.className).toContain('danger');
    expect(btn.className).toContain('lg');
  });

  it('should emit onClick when clicked', () => {
    const spy = jasmine.createSpy('click');
    component.onClick.subscribe(spy);

    const btn: HTMLButtonElement = fixture.nativeElement.querySelector('button');
    btn.click();

    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('should disable the underlying button when disabled=true', () => {
    component.disabled = true;
    fixture.detectChanges();
    const btn: HTMLButtonElement = fixture.nativeElement.querySelector('button');
    expect(btn.disabled).toBeTrue();
  });

  it('should disable the button while loading and show spinner', () => {
    component.loading = true;
    fixture.detectChanges();
    const btn: HTMLButtonElement = fixture.nativeElement.querySelector('button');
    expect(btn.disabled).toBeTrue();
    expect(btn.querySelector('.spinner')).toBeTruthy();
  });

  it('should not emit onClick when disabled button is clicked', () => {
    component.disabled = true;
    fixture.detectChanges();
    const spy = jasmine.createSpy('click');
    component.onClick.subscribe(spy);

    const btn: HTMLButtonElement = fixture.nativeElement.querySelector('button');
    btn.click();

    expect(spy).not.toHaveBeenCalled();
  });

  it('should render icon text when icon input is provided and not loading', () => {
    component.icon = '★';
    fixture.detectChanges();
    const iconEl = fixture.nativeElement.querySelector('.btn-icon');
    expect(iconEl).toBeTruthy();
    expect(iconEl!.textContent!.trim()).toBe('★');
  });
});
