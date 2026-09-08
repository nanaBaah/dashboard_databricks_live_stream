/**
 * Multi-series time-series line chart with an optional min/max band, a
 * crosshair tooltip, and end-of-line direct labels for small series counts.
 *
 * One y-axis, always: two measures on different scales get two charts, never a
 * second axis.
 */

import { useMemo, useRef } from "react";

import { CHART_INK } from "./palette.js";
import {
  AxisBottom,
  AxisLeft,
  ChartTooltip,
  DEFAULT_MARGIN,
  Gridlines,
  Legend,
  bandPath,
  extent,
  linePath,
  linearScale,
  niceTicks,
  padDomain,
  timeTicks,
  useMeasuredWidth,
  usePointer,
  type LegendItem,
  type Margin,
  type PlotPoint,
} from "./primitives.js";

export interface LineSeries {
  key: string;
  label: string;
  color: string;
  points: PlotPoint[];
}

export interface LineBand {
  label: string;
  color: string;
  points: Array<{ x: number; lo: number | null; hi: number | null }>;
}

export interface LineChartProps {
  series: LineSeries[];
  /** Optional shaded envelope drawn beneath the lines (e.g. min-max price). */
  band?: LineBand;
  height: number;
  /** Bucket width in seconds; a gap wider than 1.5x it breaks the line. */
  bucketSeconds: number;
  /** Axis tick label for an epoch-seconds x value. */
  formatTick: (x: number) => string;
  /** Tooltip heading for an epoch-seconds x value. */
  formatInstant: (x: number) => string;
  /** Axis tick label for a y value. */
  formatAxis: (y: number) => string;
  /** Tooltip value for a y value. */
  formatValue: (y: number | null) => string;
  /** Extra tooltip rows for the hovered bucket, appended after the series. */
  extraRows?: (x: number) => Array<{ label: string; value: string }>;
  /** Direct-label the line ends when the series count is small enough. */
  directLabels?: boolean;
  /** Unit of the y axis, printed above the tick column. */
  yUnit?: string;
}

const DIRECT_LABEL_MAX_SERIES = 4;

export function LineChart({
  series,
  band,
  height,
  bucketSeconds,
  formatTick,
  formatInstant,
  formatAxis,
  formatValue,
  extraRows,
  directLabels = true,
  yUnit,
}: LineChartProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const width = useMeasuredWidth(containerRef);
  const { pointer, pointerProps } = usePointer();

  const showDirectLabels = directLabels && series.length > 1 && series.length <= DIRECT_LABEL_MAX_SERIES;
  const margin: Margin = useMemo(
    () => ({
      ...DEFAULT_MARGIN,
      top: yUnit === undefined ? DEFAULT_MARGIN.top : 22,
      right: showDirectLabels ? 58 : DEFAULT_MARGIN.right,
    }),
    [showDirectLabels, yUnit],
  );

  const plot = useMemo(() => {
    const innerWidth = Math.max(width - margin.left - margin.right, 10);
    const innerHeight = Math.max(height - margin.top - margin.bottom, 10);

    const xs = series.flatMap((s) => s.points.map((p) => p.x));
    const ys = series.flatMap((s) => s.points.map((p) => p.y));
    if (band) {
      xs.push(...band.points.map((p) => p.x));
      ys.push(...band.points.flatMap((p) => [p.lo, p.hi]));
    }

    const xDomain = extent(xs);
    const yDomain = extent(ys);
    if (!xDomain || !yDomain) return null;

    const sx = linearScale(xDomain, [margin.left, margin.left + innerWidth]);
    const sy = linearScale(padDomain(yDomain), [margin.top + innerHeight, margin.top]);
    const xTicks = timeTicks(sx.domain[0], sx.domain[1], Math.max(3, Math.round(innerWidth / 110)));
    const yTicks = niceTicks(sy.domain[0], sy.domain[1], Math.max(3, Math.round(innerHeight / 46)));
    const maxGap = bucketSeconds * 1.5;

    // Every x that carries at least one value, for crosshair snapping.
    const bucketSet = new Set<number>();
    for (const s of series) for (const p of s.points) if (p.y !== null) bucketSet.add(p.x);
    const buckets = [...bucketSet].sort((a, b) => a - b);

    return { innerWidth, innerHeight, sx, sy, xTicks, yTicks, maxGap, buckets };
  }, [band, bucketSeconds, height, margin, series, width]);

  const hovered = useMemo(() => {
    if (!plot || !pointer || plot.buckets.length === 0) return null;
    if (pointer.x < margin.left - 8 || pointer.x > margin.left + plot.innerWidth + 8) return null;
    const target = plot.sx.invert(pointer.x);
    let best = plot.buckets[0]!;
    let bestDistance = Math.abs(best - target);
    for (const bucket of plot.buckets) {
      const distance = Math.abs(bucket - target);
      if (distance < bestDistance) {
        best = bucket;
        bestDistance = distance;
      }
    }
    return best;
  }, [margin.left, plot, pointer]);

  const paths = useMemo(
    () =>
      plot === null
        ? []
        : series.map((s) => ({ key: s.key, color: s.color, d: linePath(s.points, plot.sx, plot.sy, plot.maxGap) })),
    [plot, series],
  );

  const bandDrawn = useMemo(
    () => (plot === null || !band ? null : bandPath(band.points, plot.sx, plot.sy, plot.maxGap)),
    [band, plot],
  );

  const legendItems: LegendItem[] = series.map((s) => ({ key: s.key, label: s.label, color: s.color }));
  if (band) legendItems.push({ key: "__band", label: band.label, color: band.color, variant: "band" });

  // Direct labels: place at each line's last drawn point, pushed apart so two
  // close series never overprint each other.
  const endLabels = useMemo(() => {
    if (!plot || !showDirectLabels) return [];
    const raw = series
      .map((s) => {
        for (let i = s.points.length - 1; i >= 0; i -= 1) {
          const point = s.points[i]!;
          if (point.y !== null) return { key: s.key, label: s.label, color: s.color, y: plot.sy(point.y) };
        }
        return null;
      })
      .filter((entry): entry is { key: string; label: string; color: string; y: number } => entry !== null)
      .sort((a, b) => a.y - b.y);

    let previous = Number.NEGATIVE_INFINITY;
    return raw.map((entry) => {
      const y = Math.max(entry.y, previous + 13);
      previous = y;
      return { ...entry, y };
    });
  }, [plot, series, showDirectLabels]);

  return (
    <div className="chart" ref={containerRef}>
      {plot === null ? (
        <div className="chart__empty" style={{ height }}>
          No trades in this slice.
        </div>
      ) : (
        <div className="chart__canvas" style={{ height }}>
          <svg width={width} height={height} role="img" aria-label="Time series chart" {...pointerProps}>
            <Gridlines
              ticks={plot.yTicks}
              scale={plot.sy}
              x0={margin.left}
              x1={margin.left + plot.innerWidth}
            />
            <AxisLeft ticks={plot.yTicks} scale={plot.sy} x={margin.left} format={formatAxis} />
            {yUnit !== undefined && (
              <text x={2} y={11} className="chart-unit">
                {yUnit}
              </text>
            )}
            <AxisBottom
              ticks={plot.xTicks}
              scale={plot.sx}
              y={margin.top + plot.innerHeight}
              format={formatTick}
              width={width}
            />

            {band && bandDrawn !== null && (
              <path d={bandDrawn} fill={band.color} fillOpacity={0.18} stroke="none" />
            )}

            {paths.map((path) => (
              <path
                key={path.key}
                d={path.d}
                fill="none"
                stroke={path.color}
                strokeWidth={2}
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            ))}

            {hovered !== null && (
              <g>
                <line
                  x1={plot.sx(hovered)}
                  x2={plot.sx(hovered)}
                  y1={margin.top}
                  y2={margin.top + plot.innerHeight}
                  stroke={CHART_INK.secondary}
                  strokeWidth={1}
                />
                {series.map((s) => {
                  const point = s.points.find((p) => p.x === hovered);
                  if (!point || point.y === null) return null;
                  return (
                    <circle
                      key={s.key}
                      cx={plot.sx(hovered)}
                      cy={plot.sy(point.y)}
                      r={4}
                      fill={s.color}
                      stroke={CHART_INK.surface}
                      strokeWidth={2}
                    />
                  );
                })}
              </g>
            )}

            {endLabels.map((entry) => (
              <text
                key={entry.key}
                x={margin.left + plot.innerWidth + 6}
                y={entry.y}
                dominantBaseline="middle"
                className="chart-direct-label"
                fill={CHART_INK.secondary}
              >
                {entry.label}
              </text>
            ))}
          </svg>

          {hovered !== null && pointer && (
            <ChartTooltip
              x={plot.sx(hovered)}
              y={pointer.y}
              width={width}
              height={height}
              title={formatInstant(hovered)}
              rows={[
                ...series
                  .map((s) => {
                    const point = s.points.find((p) => p.x === hovered);
                    if (!point || point.y === null) return null;
                    return { label: s.label, value: formatValue(point.y), color: s.color };
                  })
                  .filter((row): row is { label: string; value: string; color: string } => row !== null),
                ...(extraRows?.(hovered) ?? []),
              ]}
            />
          )}
        </div>
      )}

      {legendItems.length > 1 && <Legend items={legendItems} />}
    </div>
  );
}
