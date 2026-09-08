/**
 * Scatter plot with a nearest-point hover layer.
 *
 * Dense scatters make pinpoint hit targets unusable, so the pointer picks the
 * nearest mark within a generous radius instead of requiring a direct hit.
 */

import { useMemo, useRef } from "react";

import { CHART_INK } from "./palette.js";
import {
  AxisBottom,
  AxisLeft,
  ChartTooltip,
  DEFAULT_MARGIN as BASE_MARGIN,
  Gridlines,
  Legend,
  extent,
  linearScale,
  niceTicks,
  padDomain,
  useMeasuredWidth,
  usePointer,
  type LegendItem,
  type TooltipRow,
} from "./primitives.js";

export interface ScatterPoint {
  key: string;
  x: number;
  y: number;
  color: string;
  title: string;
  rows: TooltipRow[];
}

export interface ScatterChartProps {
  points: ScatterPoint[];
  height: number;
  legend: LegendItem[];
  formatX: (value: number) => string;
  formatY: (value: number) => string;
  /** Axis units — without them a bare scatter says nothing about its scales. */
  xUnit: string;
  yUnit: string;
}

/** Pointer catchment radius, in pixels — comfortably past the 4px marks. */
const HIT_RADIUS = 26;

/** Room above for the y unit and below for the x unit, so neither is clipped. */
const DEFAULT_MARGIN = { ...BASE_MARGIN, top: 22, bottom: 44 };

export function ScatterChart({ points, height, legend, formatX, formatY, xUnit, yUnit }: ScatterChartProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const width = useMeasuredWidth(containerRef);
  const { pointer, pointerProps } = usePointer();

  const plot = useMemo(() => {
    const innerWidth = Math.max(width - DEFAULT_MARGIN.left - DEFAULT_MARGIN.right, 10);
    const innerHeight = Math.max(height - DEFAULT_MARGIN.top - DEFAULT_MARGIN.bottom, 10);
    const xDomain = extent(points.map((p) => p.x));
    const yDomain = extent(points.map((p) => p.y));
    if (!xDomain || !yDomain) return null;

    const sx = linearScale(padDomain([Math.min(0, xDomain[0]), xDomain[1]], 0.04), [
      DEFAULT_MARGIN.left,
      DEFAULT_MARGIN.left + innerWidth,
    ]);
    const sy = linearScale(padDomain(yDomain), [DEFAULT_MARGIN.top + innerHeight, DEFAULT_MARGIN.top]);

    return {
      innerWidth,
      innerHeight,
      sx,
      sy,
      xTicks: niceTicks(sx.domain[0], sx.domain[1], Math.max(3, Math.round(innerWidth / 120))),
      yTicks: niceTicks(sy.domain[0], sy.domain[1], Math.max(3, Math.round(innerHeight / 46))),
      placed: points.map((point) => ({ point, cx: sx(point.x), cy: sy(point.y) })),
    };
  }, [height, points, width]);

  const hovered = useMemo(() => {
    if (!plot || !pointer) return null;
    let best: { point: ScatterPoint; cx: number; cy: number } | null = null;
    let bestDistance = HIT_RADIUS * HIT_RADIUS;
    for (const candidate of plot.placed) {
      const dx = candidate.cx - pointer.x;
      const dy = candidate.cy - pointer.y;
      const distance = dx * dx + dy * dy;
      if (distance < bestDistance) {
        best = candidate;
        bestDistance = distance;
      }
    }
    return best;
  }, [plot, pointer]);

  return (
    <div className="chart" ref={containerRef}>
      {plot === null ? (
        <div className="chart__empty" style={{ height }}>
          No contracts in this slice.
        </div>
      ) : (
        <div className="chart__canvas" style={{ height }}>
          <svg
            width={width}
            height={height}
            role="img"
            aria-label="Average price versus volume"
            {...pointerProps}
          >
            <Gridlines
              ticks={plot.yTicks}
              scale={plot.sy}
              x0={DEFAULT_MARGIN.left}
              x1={DEFAULT_MARGIN.left + plot.innerWidth}
            />
            <AxisLeft ticks={plot.yTicks} scale={plot.sy} x={DEFAULT_MARGIN.left} format={formatY} />
            <text x={2} y={11} className="chart-unit">
              {yUnit}
            </text>
            <text x={width - 2} y={height - 4} textAnchor="end" className="chart-unit">
              {xUnit}
            </text>
            <AxisBottom
              ticks={plot.xTicks}
              scale={plot.sx}
              y={DEFAULT_MARGIN.top + plot.innerHeight}
              format={formatX}
              width={width}
            />

            {plot.placed.map(({ point, cx, cy }) => (
              <circle
                key={point.key}
                cx={cx}
                cy={cy}
                r={4}
                fill={point.color}
                fillOpacity={0.75}
                stroke={CHART_INK.surface}
                strokeWidth={1}
              />
            ))}

            {hovered && (
              <circle
                cx={hovered.cx}
                cy={hovered.cy}
                r={6.5}
                fill={hovered.point.color}
                stroke={CHART_INK.surface}
                strokeWidth={2}
              />
            )}
          </svg>

          {hovered && pointer && (
            <ChartTooltip
              x={hovered.cx}
              y={hovered.cy}
              width={width}
              height={height}
              title={hovered.point.title}
              rows={hovered.point.rows}
            />
          )}
        </div>
      )}
      {legend.length > 1 && <Legend items={legend} />}
    </div>
  );
}
