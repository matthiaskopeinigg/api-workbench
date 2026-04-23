import {
  AfterViewInit,
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  EventEmitter,
  HostListener,
  Input,
  NgZone,
  OnChanges,
  OnDestroy,
  Output,
  ViewChild,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { coerceToEpochMs } from '../utils/timestamp.util';

export interface TimeSeriesSeries {
  label: string;
  /** Hex / css color. */
  color: string;
  /** Y-axis values; the chart pairs them with `xs` from the parent. */
  values: number[];
  /** Optional secondary axis flag. Useful for "RPS vs latency" overlays. */
  axis?: 'left' | 'right';
}

export interface TimeSeriesViewRange {
  /** Inclusive start index in the parent’s full `xs` / `values` arrays. */
  start: number;
  /** Inclusive end index. */
  end: number;
}

const PAD = { l: 36, r: 12, t: 6, b: 20 };

/**
 * Dependency-free line chart. Supports an optional time-range “brush”
 * (drag to zoom) and a displayed window via {@link #viewRange}.
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
      <canvas
        #canvas
        (mousedown)="onDown($event)"
        (mousemove)="onMove($event)"
        (mouseup)="onUp($event)"
        (mouseleave)="onLeave($event)"
        (dblclick)="onDbl($event)"></canvas>
      <p class="ts-hint" *ngIf="enableBrush && showBrushHint">Drag to select a time range · Double-click to reset</p>
    </div>
  `,
  styles: [`
    :host { display: block; height: 100%; }
    .ts-wrap { display: flex; flex-direction: column; gap: 4px; height: 100%; }
    canvas { width: 100%; height: 100%; display: block; flex: 1 1 auto; touch-action: none; cursor: crosshair; }
    .ts-legend {
      display: flex; flex-wrap: wrap; gap: 12px;
      font-size: 11px; color: color-mix(in srgb, var(--text-color), transparent 45%);
    }
    .legend-item { display: inline-flex; align-items: center; gap: 5px; }
    .dot { width: 8px; height: 8px; border-radius: 999px; display: inline-block; }
    .ts-hint {
      margin: 0;
      font-size: 10px;
      color: color-mix(in srgb, var(--text-color), transparent 45%);
      flex: 0 0 auto;
    }
  `],
})
export class TimeSeriesChartComponent implements AfterViewInit, OnChanges, OnDestroy {
  @ViewChild('canvas', { static: true }) canvasRef!: ElementRef<HTMLCanvasElement>;

  @Input() xs: number[] = [];
  @Input() series: TimeSeriesSeries[] = [];
  @Input() minPoints = 2;

  /**
   * If set, only the inclusive index range is drawn. Combined with
   * {@link #enableBrush} the user can narrow a region of the full run.
   */
  @Input() viewRange: TimeSeriesViewRange | null = null;

  /** When set, the user can drag to emit a new {@link #viewRangeChange}. */
  @Input() enableBrush = false;
  @Input() showBrushHint = true;

  @Output() viewRangeChange = new EventEmitter<TimeSeriesViewRange | null>();

  private rafHandle: number | null = null;
  private resizeObs?: ResizeObserver;

  private drag:
    | { startIdx: number; curX: number; curIdx: number; active: boolean }
    | null = null;

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

  onDown(e: MouseEvent): void {
    if (!this.enableBrush) return;
    const canvas = this.canvasRef?.nativeElement;
    if (!canvas) return;
    const fullLen = this.xs.length;
    if (fullLen < 2) return;
    const { offset, count } = this.getViewMeta();
    const idx = this.pixelToIndex(e.offsetX, offset, count, fullLen, canvas);
    this.drag = { startIdx: idx, curX: e.offsetX, curIdx: idx, active: true };
  }

  onMove(e: MouseEvent): void {
    if (!this.drag?.active) return;
    this.drag.curX = e.offsetX;
    const canvas = this.canvasRef?.nativeElement;
    if (!canvas) return;
    const fullLen = this.xs.length;
    const { offset, count } = this.getViewMeta();
    this.drag.curIdx = this.pixelToIndex(e.offsetX, offset, count, fullLen, canvas);
    this.scheduleDraw();
  }

  onUp(e: MouseEvent): void {
    if (!this.enableBrush || !this.drag?.active) {
      this.drag = null;
      return;
    }
    const d = this.drag;
    this.drag = null;
    const canvas = this.canvasRef?.nativeElement;
    if (!canvas) return;
    const fullLen = this.xs.length;
    if (fullLen < 2) {
      this.scheduleDraw();
      return;
    }
    const { offset, count } = this.getViewMeta();
    const endIdx = this.pixelToIndex(e.offsetX, offset, count, fullLen, canvas);
    const a = d.startIdx;
    const b = endIdx;
    if (Math.abs(b - a) < 1 && Math.abs(e.offsetX - d.curX) < 3) {
      this.scheduleDraw();
      return;
    }
    const start = Math.max(0, Math.min(a, b));
    const end = Math.min(fullLen - 1, Math.max(a, b));
    if (end - start < 1) {
      this.scheduleDraw();
      return;
    }
    this.zone.run(() => {
      this.viewRangeChange.emit({ start, end });
    });
    this.scheduleDraw();
  }

  onLeave(e: MouseEvent): void {
    if (this.drag?.active) {
      this.onUp(e);
    }
  }

  onDbl(_e: MouseEvent): void {
    if (!this.enableBrush) return;
    this.drag = null;
    this.zone.run(() => {
      this.viewRangeChange.emit(null);
    });
    this.scheduleDraw();
  }

  private getViewMeta(): { offset: number; count: number } {
    const full = this.xs.length;
    if (full < 1) {
      return { offset: 0, count: 0 };
    }
    const r = this.viewRange;
    if (r) {
      const s = Math.max(0, r.start);
      const e = Math.min(full - 1, r.end);
      return { offset: s, count: e - s + 1 };
    }
    return { offset: 0, count: full };
  }

  private pixelToIndex(
    offsetX: number,
    viewOffset: number,
    viewCount: number,
    fullLen: number,
    canvas: HTMLCanvasElement,
  ): number {
    const w = canvas.clientWidth;
    const innerW = w - PAD.l - PAD.r;
    if (innerW <= 0 || viewCount < 1) {
      return 0;
    }
    const t = (offsetX - PAD.l) / innerW;
    const clamped = Math.max(0, Math.min(1, t));
    const xLen = Math.max(1, viewCount - 1);
    const local = Math.round(clamped * xLen);
    return Math.max(0, Math.min(fullLen - 1, viewOffset + local));
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

    const padL = PAD.l;
    const padR = PAD.r;
    const padT = PAD.t;
    const padB = PAD.b;
    const innerW = cssW - padL - padR;
    const innerH = cssH - padT - padB;
    if (innerW <= 0 || innerH <= 0) return;

    const fullXs = this.xs;
    const { offset, count } = this.getViewMeta();
    if (count < 1) {
      ctx.fillStyle = 'rgba(120,120,120,0.6)';
      ctx.font = '11px system-ui';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('No data in range', cssW / 2, cssH / 2);
      return;
    }

    const sliceXs = fullXs.slice(offset, offset + count);
    const series = this.series
      .map((s) => ({ ...s, values: s.values.slice(offset, offset + count) }))
      .filter((s) => s.values.length >= this.minPoints);

    if (sliceXs.length < this.minPoints || !series.length) {
      ctx.fillStyle = 'rgba(120,120,120,0.6)';
      ctx.font = '11px system-ui';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
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
      ctx.moveTo(padL, y);
      ctx.lineTo(padL + innerW, y);
    }
    ctx.stroke();

    ctx.fillStyle = 'rgba(120,120,120,0.85)';
    ctx.font = '10px system-ui';
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    for (let i = 0; i <= 4; i++) {
      const v = max - ((max - min) * i) / 4;
      const y = padT + (innerH * i) / 4;
      ctx.fillText(v >= 100 ? v.toFixed(0) : v.toFixed(1), padL - 6, y);
    }

    const t0 = sliceXs[0];
    const t1 = sliceXs[sliceXs.length - 1];
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillStyle = 'rgba(100,100,100,0.8)';
    ctx.fillText(this.fmtTick(t0), padL, padT + innerH + 2);
    ctx.textAlign = 'right';
    ctx.fillText(this.fmtTick(t1), padL + innerW, padT + innerH + 2);

    const xLen = Math.max(1, sliceXs.length - 1);
    for (const s of series) {
      ctx.strokeStyle = s.color;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      let first = true;
      const n = Math.min(s.values.length, sliceXs.length);
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

    if (this.drag?.active) {
      const a = this.drag.startIdx;
      const b = this.drag.curIdx;
      const s = Math.max(offset, Math.min(a, b));
      const e = Math.min(offset + count - 1, Math.max(a, b));
      const sLocal = s - offset;
      const eLocal = e - offset;
      if (eLocal >= sLocal) {
        const x0 = padL + (innerW * sLocal) / xLen;
        const x1 = padL + (innerW * eLocal) / xLen;
        ctx.fillStyle = 'rgba(37, 99, 235, 0.12)';
        ctx.fillRect(x0, padT, x1 - x0, innerH);
        ctx.strokeStyle = 'rgba(37, 99, 235, 0.4)';
        ctx.lineWidth = 1;
        ctx.strokeRect(x0, padT, x1 - x0, innerH);
      }
    }
  }

  private fmtTick(t: number): string {
    if (!Number.isFinite(t)) return '';
    if (t > 1e12) {
      const ms = coerceToEpochMs(t) ?? t;
      return new Date(ms).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    }
    if (t > 1e9) {
      return (t / 1000).toFixed(1) + ' s';
    }
    return String(Math.round(t));
  }
}
