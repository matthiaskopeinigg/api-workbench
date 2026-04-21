import { ComponentFixture, TestBed } from '@angular/core/testing';
import { DropdownComponent, DropdownOption } from './dropdown.component';

describe('DropdownComponent', () => {
  let component: DropdownComponent;
  let fixture: ComponentFixture<DropdownComponent>;

  const options: DropdownOption[] = [
    { label: 'GET', value: 'GET' },
    { label: 'POST', value: 'POST' },
    { label: 'DELETE', value: 'DELETE' }
  ];

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [DropdownComponent]
    }).compileComponents();

    fixture = TestBed.createComponent(DropdownComponent);
    component = fixture.componentInstance;
    component.options = options;
    fixture.detectChanges();
  });

  it('should create and start closed', () => {
    expect(component).toBeTruthy();
    expect(component.isOpen).toBeFalse();
  });

  it('toggle() should flip isOpen', () => {
    component.toggle();
    expect(component.isOpen).toBeTrue();
    component.toggle();
    expect(component.isOpen).toBeFalse();
  });

  it('close() should set isOpen to false', () => {
    component.isOpen = true;
    component.close();
    expect(component.isOpen).toBeFalse();
  });

  it('selectedLabel should return the selected option label', () => {
    component.value = 'POST';
    expect(component.selectedLabel).toBe('POST');
  });

  it('selectedLabel should fall back to placeholder when no option matches', () => {
    component.placeholder = 'Pick one';
    component.value = 'UNKNOWN';
    expect(component.selectedLabel).toBe('Pick one');
  });

  it('select() should update value, emit valueChange, and close the menu', () => {
    const emitSpy = jasmine.createSpy('valueChange');
    component.valueChange.subscribe(emitSpy);
    component.isOpen = true;

    component.select(options[2]);

    expect(component.value).toBe('DELETE');
    expect(emitSpy).toHaveBeenCalledWith('DELETE');
    expect(component.isOpen).toBeFalse();
  });

  it('should respect alignment input (left by default)', () => {
    expect(component.align).toBe('left');
    component.align = 'right';
    fixture.detectChanges();
    expect(component.align).toBe('right');
  });
});
