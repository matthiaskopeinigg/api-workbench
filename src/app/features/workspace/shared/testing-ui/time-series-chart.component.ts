import {
  AfterViewInit,
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  HostListener,
  Input,
  NgZone,
  OnChanges,
  OnDestroy,
  ViewChild,
} from '@angular/core';
import { CommonModule } from '@angular/common';

export interface TimeSeriesSeries {
  label: string;
  /** Hex / css color. */
  color: string;
  /** Y-axis values; the chart pairs them with `xs` from the parent. */
  values: number[];
  /** Optional secondary axis flag. Useful for "RPS vs latency" overlays. */
  axis?: 'left' | 'right';
}

/**
 * Tiny dependency-free line chart. Renders into a single canvas with
 * `requestAnimationFrame`-coalesced repaints. Designed for ~1k points.
 *
 * The chart deliberately lacks zoom / tooltips for now — keep it cheap;
 * a larger viz library is a follow-up if we ever need them.
 */
@Component({
  selector: 'aw-time-series-chart',
  standalone: true,
  imports: [CommonModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="ts-wrap">
      <div class="ts-legend" *ngIf="series.length">
        <span *ngFor="let s of series" class="legend-item">
          <span class="dot" [style.background]="s.color"></span>{{ s.label }}
        </span>
      </div>
      <canvas #canvas></canvas>
    </div>
  `,
  styles: [`
    :host { display: block; height: 100%; }
    .ts-wrap { display: flex; flex-direction: column; gap: 4px; height: 100%; }
    canvas { width: 100%; height: 100%; display: block; flex: 1 1 auto; }
    .ts-legend {
      display: flex; flex-wrap: wrap; gap: 12px;
      font-size: 11px; color: color-mix(in srgb, var(--text-color), transparent 45%);
    }
    .legend-item { display: inline-flex; align-items: center; gap: 5px; }
    .dot { width: 8px; height: 8px; border-radius: 999px; display: inline-block; }
  `],
})
export class TimeSeriesChartComponent implements AfterViewInit, OnChanges, OnDestroy {
  @ViewChild('canvas', { static: true }) canvasRef!: ElementRef<HTMLCanvasElement>;

  /** X-axis values. Treated as opaque numbers; we just plot evenly-spaced. */
  @Input() xs: number[] = [];
  @Input() series: TimeSeriesSeries[] = [];
  /** Min number of points before we start drawing. Smooths startup flicker. */
  @Input() minPoints = 2;

  private rafHandle: number | null = null;
  private resizeObs?: ResizeObserver;

  constructor(private host: ElementRef<HTMLElement>, private zone: NgZone) {}

  ngAfterViewInit(): void {
    this.zone.runOutsideAngular(() => {
      this.resizeObs = new ResizeObserver(() => this.scheduleDraw());
      this.resizeObs.observe(this.host.nativeElement);
      this.scheduleDraw();
    });
  }

  ngOnChanges(): void {
    this.scheduleDraw();
  }

  ngOnDestroy(): void {
    this.resizeObs?.disconnect();
    if (this.rafHandle !== null) cancelAnimationFrame(this.rafHandle);
  }

  @HostListener('window:resize')
  onResize() { this.scheduleDraw(); }

  private scheduleDraw(): void {
    if (this.rafHandle !== null) return;
    this.zone.runOutsideAngular(() => {
      this.rafHandle = requestAnimationFrame(() => {
        this.rafHandle = null;
        this.draw();
      });
    });
  }

  private draw(): void {
    const canvas = this.canvasRef?.nativeElement;
    if (!canvas) return;

    const dpr = window.devicePixelRatio || 1;
    const cssW = canvas.clientWidth;
    const cssH = canvas.clientHeight;
    if (cssW < 4 || cssH < 4) return;
    canvas.width = Math.floor(cssW * dpr);
    canvas.height = Math.floor(cssH * dpr);

    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cssW, cssH);

    const padL = 36, padR = 12, padT = 6, padB = 18;
    const innerW = cssW - padL - padR;
    const innerH = cssH - padT - padB;
    if (innerW <= 0 || innerH <= 0) return;

    const xs = this.xs;
    const series = this.series.filter((s) => s.values.length >= this.minPoints);
    if (xs.length < this.minPoints || !series.length) {
      ctx.fillStyle = 'rgba(120,120,120,0.6)';
      ctx.font = '11px system-ui';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText('Waiting for data…', cssW / 2, cssH / 2);
      return;
    }

    let min = Infinity, max = -Infinity;
    for (const s of series) for (const v of s.values) {
      if (Number.isFinite(v)) { if (v < min) min = v; if (v > max) max = v; }
    }
    if (!Number.isFinite(min)) min = 0;
    if (!Number.isFinite(max)) max = 1;
    if (min === max) { min -= 1; max += 1; }
    const yPad = (max - min) * 0.08;
    min -= yPad; max += yPad;

    ctx.strokeStyle = 'rgba(120,120,120,0.18)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let i = 0; i <= 4; i++) {
      const y = padT + (innerH * i) / 4;
      ctx.moveTo(padL, y); ctx.lineTo(padL + innerW, y);
    }
    ctx.stroke();

    ctx.fillStyle = 'rgba(120,120,120,0.85)';
    ctx.font = '10px system-ui';
    ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
    for (let i = 0; i <= 4; i++) {
      const v = max - ((max - min) * i) / 4;
      const y = padT + (innerH * i) / 4;
      ctx.fillText(v >= 100 ? v.toFixed(0) : v.toFixed(1), padL - 6, y);
    }

    const xLen = Math.max(1, xs.length - 1);
    for (const s of series) {
      ctx.strokeStyle = s.color;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      let first = true;
      const n = Math.min(s.values.length, xs.length);
      for (let i = 0; i < n; i++) {
        const v = s.values[i];
        if (!Number.isFinite(v)) continue;
        const x = padL + (innerW * i) / xLen;
        const y = padT + innerH * (1 - (v - min) / (max - min));
        if (first) { ctx.moveTo(x, y); first = false; }
        else ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
  }
}
