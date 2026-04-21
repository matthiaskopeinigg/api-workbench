import { ComponentFixture, TestBed } from '@angular/core/testing';
import { InputComponent } from './input.component';

describe('InputComponent', () => {
  let component: InputComponent;
  let fixture: ComponentFixture<InputComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [InputComponent]
    }).compileComponents();

    fixture = TestBed.createComponent(InputComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create with sensible defaults', () => {
    expect(component).toBeTruthy();
    expect(component.type).toBe('text');
    expect(component.disabled).toBeFalse();
    expect(component.id).toMatch(/^input-[a-z0-9]+$/);
  });

  it('should render a label element only when label input is set', () => {
    expect(fixture.nativeElement.querySelector('label')).toBeNull();

    component.label = 'Email';
    fixture.detectChanges();

    const labelEl: HTMLLabelElement = fixture.nativeElement.querySelector('label');
    expect(labelEl).toBeTruthy();
    expect(labelEl.textContent).toContain('Email');
    expect(labelEl.getAttribute('for')).toBe(component.id);
  });

  it('should render icon span only when icon input is set', () => {
    expect(fixture.nativeElement.querySelector('.input-icon')).toBeNull();
    component.icon = '@';
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.input-icon')?.textContent).toContain('@');
  });

  it('should update value and notify registerOnChange on input', () => {
    const changeSpy = jasmine.createSpy('onChange');
    component.registerOnChange(changeSpy);

    const inputEl: HTMLInputElement = fixture.nativeElement.querySelector('input');
    inputEl.value = 'hello';
    inputEl.dispatchEvent(new Event('input'));

    expect(component.value).toBe('hello');
    expect(changeSpy).toHaveBeenCalledWith('hello');
  });

  it('writeValue should populate the component value (and coerce nullish to empty string)', () => {
    component.writeValue('abc');
    expect(component.value).toBe('abc');

    component.writeValue(null as any);
    expect(component.value).toBe('');
  });

  it('registerOnTouched should be invoked on blur', () => {
    const touchedSpy = jasmine.createSpy('onTouched');
    component.registerOnTouched(touchedSpy);

    const inputEl: HTMLInputElement = fixture.nativeElement.querySelector('input');
    inputEl.dispatchEvent(new Event('blur'));

    expect(touchedSpy).toHaveBeenCalled();
  });

  it('setDisabledState should toggle the disabled flag', () => {
    component.setDisabledState(true);
    expect(component.disabled).toBeTrue();

    component.setDisabledState(false);
    expect(component.disabled).toBeFalse();
  });
});
