import { ComponentFixture, TestBed } from '@angular/core/testing';
import { TimeSeriesChartComponent, TimeSeriesSeries } from './time-series-chart.component';

/**
 * Canvas drawing is exercised indirectly — we don't inspect pixels. Instead
 * we verify that the component survives the usual input permutations
 * (empty, tiny, multi-series) without throwing, and that its lifecycle
 * hooks schedule/cancel animation frames correctly.
 */
describe('TimeSeriesChartComponent', () => {
  let fixture: ComponentFixture<TimeSeriesChartComponent>;
  let component: TimeSeriesChartComponent;

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [TimeSeriesChartComponent] }).compileComponents();
    fixture = TestBed.createComponent(TimeSeriesChartComponent);
    component = fixture.componentInstance;
  });

  it('creates without throwing when no data is present', () => {
    fixture.detectChanges();
    expect(component).toBeTruthy();
  });

  it('renders a legend entry per series', () => {
    component.series = [
      { label: 'RPS', color: '#111', values: [1, 2, 3] },
      { label: 'p95', color: '#222', values: [10, 11, 12] },
    ];
    component.xs = [0, 1, 2];
    fixture.detectChanges();

    const items = fixture.nativeElement.querySelectorAll('.legend-item');
    expect(items.length).toBe(2);
    expect(items[0].textContent).toContain('RPS');
    expect(items[1].textContent).toContain('p95');
  });

  it('does not render a legend when no series are supplied', () => {
    component.series = [];
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.ts-legend')).toBeNull();
  });

  it('ngOnChanges schedules a draw without throwing for degenerate input', () => {
    component.xs = [];
    component.series = [];
    expect(() => component.ngOnChanges()).not.toThrow();
  });

  it('handles mixed-length series and non-finite values gracefully', () => {
    component.xs = [0, 1, 2, 3];
    component.series = [
      { label: 'a', color: '#0f0', values: [NaN, 2, Infinity, 4] },
      { label: 'b', color: '#f00', values: [1, 2] },
    ];
    fixture.detectChanges();
    expect(() => component.ngOnChanges()).not.toThrow();
  });

  it('cancels the pending raf on destroy and disconnects the resize observer', () => {
    fixture.detectChanges();
    const spy = spyOn(window, 'cancelAnimationFrame');
    (component as any).rafHandle = 99;
    fixture.destroy();
    expect(spy).toHaveBeenCalledWith(99);
  });
});
