import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { StatCardComponent } from './stat-card.component';

describe('StatCardComponent', () => {
  let fixture: ComponentFixture<StatCardComponent>;
  let component: StatCardComponent;

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [StatCardComponent] }).compileComponents();
    fixture = TestBed.createComponent(StatCardComponent);
    component = fixture.componentInstance;
  });

  it('renders the label and value', () => {
    component.label = 'Requests';
    component.value = 42;
    fixture.detectChanges();

    const host: HTMLElement = fixture.nativeElement;
    expect(host.querySelector('.label')!.textContent!.trim()).toBe('Requests');
    expect(host.querySelector('.num')!.textContent!.trim()).toBe('42');
  });

  it('omits the unit and sub elements when not provided', () => {
    component.label = 'Errors';
    component.value = 0;
    fixture.detectChanges();

    expect(fixture.debugElement.query(By.css('.unit'))).toBeNull();
    expect(fixture.debugElement.query(By.css('.sub'))).toBeNull();
  });

  it('renders the unit and sub fragments when supplied', () => {
    component.label = 'Latency';
    component.value = 120;
    component.unit = 'ms';
    component.sub = 'p95 window';
    fixture.detectChanges();

    const host: HTMLElement = fixture.nativeElement;
    expect(host.querySelector('.unit')!.textContent!.trim()).toBe('ms');
    expect(host.querySelector('.sub')!.textContent!.trim()).toBe('p95 window');
  });

  it('applies the tone-<value> class to the card root', () => {
    fixture.componentRef.setInput('tone', 'error');
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.stat-card')!.classList).toContain('tone-error');

    fixture.componentRef.setInput('tone', 'success');
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.stat-card')!.classList).toContain('tone-success');
  });

  it('defaults value to the em-dash placeholder when not assigned', () => {
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.num')!.textContent!.trim()).toBe('–');
  });
});
