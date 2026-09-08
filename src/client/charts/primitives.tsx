/**
 * Shared SVG chart primitives: scales, ticks, axes, legend, tooltip.
 *
 * Deliberately dependency-free — the app ships pre-bundled to Databricks Apps,
 * and these five panels need a fraction of what a charting library carries.
 * Every chart is one `<svg>` sized to its container by `useMeasuredWidth`, with
 * an absolutely-positioned HTML tooltip layered over it.
 */

import {
  useCallback,
  useLayoutEffect,
  useState,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  type RefObject,
} from "react";

import { CHART_INK } from "./palette.js";

/** Plot insets. Bottom leaves room for the x-axis band so it is never clipped. */
export interface Margin {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export const DEFAULT_MARGIN: Margin = { top: 10, right: 14, bottom: 30, left: 58 };

/** Measure a container so the SVG can be sized in real pixels (crisp text). */
export function useMeasuredWidth(ref: RefObject<HTMLElement | null>): number {
  const [width, setWidth] = useState(0);

  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    setWidth(element.clientWidth);
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver((entries) => {
      const next = entries[0]?.contentRect.width;
      if (typeof next === "number") setWidth(next);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [ref]);

  return width;
}

export interface Scale {
  (value: number): number;
  invert: (pixel: number) => number;
  domain: [number, number];
  range: [number, number];
}

/** Linear scale; a zero-width domain is widened so a flat series still renders. */
export function linearScale(domain: [number, number], range: [number, number]): Scale {
  let [d0, d1] = domain;
  if (!Number.isFinite(d0) || !Number.isFinite(d1)) {
    d0 = 0;
    d1 = 1;
  }
  if (d0 === d1) {
    const pad = Math.abs(d0) > 0 ? Math.abs(d0) * 0.05 : 0.5;
    d0 -= pad;
    d1 += pad;
  }
  const [r0, r1] = range;
  const scale = ((value: number) => r0 + ((value - d0) / (d1 - d0)) * (r1 - r0)) as Scale;
  scale.invert = (pixel: number) => d0 + ((pixel - r0) / (r1 - r0)) * (d1 - d0);
  scale.domain = [d0, d1];
  scale.range = [r0, r1];
  return scale;
}

/** Ticks on a 1/2/5 × 10^n grid, covering the domain without overshooting it. */
export function niceTicks(min: number, max: number, target = 5): number[] {
  if (!Number.isFinite(min) || !Number.isFinite(max) || min === max) return [min];
  const rawStep = (max - min) / Math.max(target, 1);
  const magnitude = 10 ** Math.floor(Math.log10(rawStep));
  const normalized = rawStep / magnitude;
  const step = (normalized >= 5 ? 10 : normalized >= 2 ? 5 : normalized >= 1 ? 2 : 1) * magnitude;
  const ticks: number[] = [];
  for (let value = Math.ceil(min / step) * step; value <= max + step * 1e-6; value += step) {
    ticks.push(Math.abs(value) < step * 1e-6 ? 0 : value);
  }
  return ticks;
}

/** Whole-unit time steps, in seconds, from a minute to a week. */
const TIME_STEPS = [60, 300, 900, 1_800, 3_600, 7_200, 10_800, 21_600, 43_200, 86_400, 172_800, 604_800];

/** Ticks on a calendar-ish grid: aligned to the step, so labels read cleanly. */
export function timeTicks(minSeconds: number, maxSeconds: number, target = 6): number[] {
  if (!Number.isFinite(minSeconds) || !Number.isFinite(maxSeconds) || maxSeconds <= minSeconds) {
    return [minSeconds];
  }
  const rawStep = (maxSeconds - minSeconds) / Math.max(target, 1);
  const step = TIME_STEPS.find((candidate) => candidate >= rawStep) ?? TIME_STEPS[TIME_STEPS.length - 1]!;
  const ticks: number[] = [];
  for (let value = Math.ceil(minSeconds / step) * step; value <= maxSeconds; value += step) {
    ticks.push(value);
  }
  return ticks;
}

/** Extent of finite values, or null when there are none. */
export function extent(values: Array<number | null | undefined>): [number, number] | null {
  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;
  for (const value of values) {
    if (value === null || value === undefined || !Number.isFinite(value)) continue;
    if (value < min) min = value;
    if (value > max) max = value;
  }
  return min <= max ? [min, max] : null;
}

/** Pad a numeric domain by a fraction of its span so marks clear the frame. */
export function padDomain([min, max]: [number, number], fraction = 0.08): [number, number] {
  const span = max - min || Math.abs(max) || 1;
  return [min - span * fraction, max + span * fraction];
}

export interface PlotPoint {
  x: number;
  y: number | null;
}

/**
 * Build an SVG path, starting a new sub-path at a null value or a gap wider
 * than `maxGap` — an empty bucket must break the line, never be interpolated
 * across.
 */
export function linePath(points: PlotPoint[], sx: Scale, sy: Scale, maxGap = Number.POSITIVE_INFINITY): string {
  let path = "";
  let previousX: number | null = null;
  for (const point of points) {
    if (point.y === null || !Number.isFinite(point.y)) {
      previousX = null;
      continue;
    }
    const broken = previousX === null || point.x - previousX > maxGap;
    path += `${broken ? "M" : "L"}${sx(point.x).toFixed(2)} ${sy(point.y).toFixed(2)}`;
    previousX = point.x;
  }
  return path;
}

/** Closed area between `hi` and `lo`, split on gaps the same way `linePath` is. */
export function bandPath(
  points: Array<{ x: number; lo: number | null; hi: number | null }>,
  sx: Scale,
  sy: Scale,
  maxGap = Number.POSITIVE_INFINITY,
): string {
  let path = "";
  let run: Array<{ x: number; lo: number; hi: number }> = [];

  const flush = () => {
    if (run.length < 2) {
      run = [];
      return;
    }
    const top = run.map((p) => `${sx(p.x).toFixed(2)} ${sy(p.hi).toFixed(2)}`);
    const bottom = [...run].reverse().map((p) => `${sx(p.x).toFixed(2)} ${sy(p.lo).toFixed(2)}`);
    path += `M${top.join("L")}L${bottom.join("L")}Z`;
    run = [];
  };

  for (const point of points) {
    const usable =
      point.lo !== null && point.hi !== null && Number.isFinite(point.lo) && Number.isFinite(point.hi);
    const last = run[run.length - 1];
    if (!usable || (last !== undefined && point.x - last.x > maxGap)) {
      flush();
      if (!usable) continue;
    }
    run.push({ x: point.x, lo: point.lo as number, hi: point.hi as number });
  }
  flush();
  return path;
}

/** Recessive horizontal gridlines plus the axis rule. Solid hairlines only. */
export function Gridlines({
  ticks,
  scale,
  x0,
  x1,
}: {
  ticks: number[];
  scale: Scale;
  x0: number;
  x1: number;
}) {
  return (
    <g aria-hidden="true">
      {ticks.map((tick) => (
        <line
          key={tick}
          x1={x0}
          x2={x1}
          y1={scale(tick)}
          y2={scale(tick)}
          stroke={CHART_INK.grid}
          strokeWidth={1}
          shapeRendering="crispEdges"
        />
      ))}
    </g>
  );
}

export function AxisLeft({
  ticks,
  scale,
  x,
  format,
}: {
  ticks: number[];
  scale: Scale;
  x: number;
  format: (value: number) => string;
}) {
  return (
    <g aria-hidden="true">
      {ticks.map((tick) => (
        <text
          key={tick}
          x={x - 8}
          y={scale(tick)}
          textAnchor="end"
          dominantBaseline="middle"
          className="chart-tick"
        >
          {format(tick)}
        </text>
      ))}
    </g>
  );
}

export function AxisBottom({
  ticks,
  scale,
  y,
  format,
  width,
}: {
  ticks: number[];
  scale: Scale;
  y: number;
  format: (value: number) => string;
  width: number;
}) {
  return (
    <g aria-hidden="true">
      <line x1={scale.range[0]} x2={scale.range[1]} y1={y} y2={y} stroke={CHART_INK.axis} strokeWidth={1} />
      {ticks.map((tick) => {
        const cx = scale(tick);
        // Drop a label that would be clipped by the frame rather than crop it.
        if (cx < 18 || cx > width - 18) return null;
        return (
          <text key={tick} x={cx} y={y + 16} textAnchor="middle" className="chart-tick">
            {format(tick)}
          </text>
        );
      })}
    </g>
  );
}

export interface LegendItem {
  key: string;
  label: string;
  color: string;
  /** Optional trailing value, e.g. a share or total. */
  value?: string;
  /**
   * `band` draws a translucent swatch with an outline, matching how a filled
   * envelope actually renders — a solid swatch would read as another line.
   */
  variant?: "mark" | "band";
}

/** Identity is never colour-alone: every chart with >= 2 series renders this. */
export function Legend({ items, onHover }: { items: LegendItem[]; onHover?: (key: string | null) => void }) {
  return (
    <ul className="chart-legend">
      {items.map((item) => (
        <li
          key={item.key}
          className="chart-legend__item"
          onMouseEnter={() => onHover?.(item.key)}
          onMouseLeave={() => onHover?.(null)}
        >
          <span
            className={`chart-legend__swatch${item.variant === "band" ? " chart-legend__swatch--band" : ""}`}
            style={
              item.variant === "band"
                ? { background: item.color, borderColor: item.color }
                : { background: item.color }
            }
            aria-hidden="true"
          />
          <span className="chart-legend__label">{item.label}</span>
          {item.value !== undefined && <span className="chart-legend__value">{item.value}</span>}
        </li>
      ))}
    </ul>
  );
}

export interface TooltipRow {
  label: string;
  value: string;
  color?: string;
}

/** Tooltip anchored inside the chart box. */
export function ChartTooltip({
  x,
  y,
  width,
  height,
  title,
  rows,
  footer,
}: {
  x: number;
  y: number;
  width: number;
  height: number;
  title: string;
  rows: TooltipRow[];
  footer?: ReactNode;
}) {
  // Flip to the other side of the cursor near an edge: the panel clips its
  // overflow, so a tooltip that runs past the box would be cut off.
  const flipX = x > width * 0.6;
  const flipY = y > height * 0.55;
  return (
    <div
      className="chart-tooltip"
      style={{
        left: flipX ? undefined : x + 14,
        right: flipX ? width - x + 14 : undefined,
        top: flipY ? undefined : Math.max(y - 12, 4),
        bottom: flipY ? Math.max(height - y - 12, 4) : undefined,
      }}
      role="tooltip"
    >
      <div className="chart-tooltip__title">{title}</div>
      <table className="chart-tooltip__rows">
        <tbody>
          {rows.map((row, index) => (
            <tr key={`${row.label}-${index}`}>
              <td>
                {row.color !== undefined && (
                  <span className="chart-tooltip__swatch" style={{ background: row.color }} aria-hidden="true" />
                )}
                {row.label}
              </td>
              <td className="chart-tooltip__value">{row.value}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {footer !== undefined && <div className="chart-tooltip__footer">{footer}</div>}
    </div>
  );
}

/** Pointer position within an element, in element-local pixels. */
export interface PointerPosition {
  x: number;
  y: number;
}

export interface PointerTracking {
  pointer: PointerPosition | null;
  /** Spread onto the element being tracked. */
  pointerProps: {
    onPointerMove: (event: ReactPointerEvent<Element>) => void;
    onPointerLeave: () => void;
  };
}

/**
 * Track the pointer over a chart.
 *
 * Bound through React event props rather than `addEventListener` in an effect:
 * a chart that renders its empty state first and its `<svg>` only once data
 * arrives would otherwise never get listeners attached.
 */
export function usePointer(): PointerTracking {
  const [pointer, setPointer] = useState<PointerPosition | null>(null);

  const onPointerMove = useCallback((event: ReactPointerEvent<Element>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    setPointer({ x: event.clientX - rect.left, y: event.clientY - rect.top });
  }, []);

  const onPointerLeave = useCallback(() => setPointer(null), []);

  return { pointer, pointerProps: { onPointerMove, onPointerLeave } };
}
