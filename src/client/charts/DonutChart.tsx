/**
 * Part-to-whole donut, capped at six segments (the long tail folds into
 * "Other" before it gets here). Segments are separated by a surface-coloured
 * gap rather than a border, and the total sits in the hole.
 */

import { useMemo, useRef, useState } from "react";

import { CHART_INK } from "./palette.js";
import { ChartTooltip, Legend, useMeasuredWidth, type LegendItem } from "./primitives.js";

export interface DonutSegment {
  key: string;
  label: string;
  color: string;
  value: number;
}

export interface DonutChartProps {
  segments: DonutSegment[];
  height: number;
  /** Centre figure, e.g. the total volume. */
  centerValue: string;
  centerLabel: string;
  formatValue: (value: number) => string;
  /** Tooltip heading for a segment. */
  unitLabel: string;
}

/** Pixel gap between segments, converted to an angle at render time. */
const GAP_PX = 2;

function arcPath(cx: number, cy: number, rOuter: number, rInner: number, start: number, end: number): string {
  const large = end - start > Math.PI ? 1 : 0;
  const x0 = cx + rOuter * Math.cos(start);
  const y0 = cy + rOuter * Math.sin(start);
  const x1 = cx + rOuter * Math.cos(end);
  const y1 = cy + rOuter * Math.sin(end);
  const x2 = cx + rInner * Math.cos(end);
  const y2 = cy + rInner * Math.sin(end);
  const x3 = cx + rInner * Math.cos(start);
  const y3 = cy + rInner * Math.sin(start);
  return (
    `M${x0.toFixed(2)} ${y0.toFixed(2)}` +
    `A${rOuter} ${rOuter} 0 ${large} 1 ${x1.toFixed(2)} ${y1.toFixed(2)}` +
    `L${x2.toFixed(2)} ${y2.toFixed(2)}` +
    `A${rInner} ${rInner} 0 ${large} 0 ${x3.toFixed(2)} ${y3.toFixed(2)}Z`
  );
}

export function DonutChart({
  segments,
  height,
  centerValue,
  centerLabel,
  formatValue,
  unitLabel,
}: DonutChartProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const width = useMeasuredWidth(containerRef);
  const [hovered, setHovered] = useState<string | null>(null);
  const [pointer, setPointer] = useState<{ x: number; y: number } | null>(null);

  const total = segments.reduce((sum, segment) => sum + Math.max(segment.value, 0), 0);

  const arcs = useMemo(() => {
    if (total <= 0 || width <= 0) return [];
    const cx = width / 2;
    const cy = height / 2;
    const rOuter = Math.max(Math.min(width, height) / 2 - 8, 12);
    const rInner = rOuter * 0.62;
    const gap = GAP_PX / rOuter;

    let angle = -Math.PI / 2;
    return segments
      .filter((segment) => segment.value > 0)
      .map((segment) => {
        const sweep = (segment.value / total) * Math.PI * 2;
        const start = angle;
        const end = angle + sweep;
        angle = end;
        // Only inset when the segment is wide enough to survive it.
        const inset = sweep > gap * 3 ? gap / 2 : 0;
        return {
          ...segment,
          share: segment.value / total,
          d: arcPath(cx, cy, rOuter, rInner, start + inset, end - inset),
        };
      });
  }, [height, segments, total, width]);

  const legendItems: LegendItem[] = arcs.map((arc) => ({
    key: arc.key,
    label: arc.label,
    color: arc.color,
    value: `${(arc.share * 100).toFixed(1)}%`,
  }));

  const hoveredArc = arcs.find((arc) => arc.key === hovered) ?? null;

  return (
    <div className="chart" ref={containerRef}>
      {arcs.length === 0 ? (
        <div className="chart__empty" style={{ height }}>
          No volume in this slice.
        </div>
      ) : (
        <div
          className="chart__canvas"
          style={{ height }}
          onPointerMove={(event) => {
            const rect = event.currentTarget.getBoundingClientRect();
            setPointer({ x: event.clientX - rect.left, y: event.clientY - rect.top });
          }}
          onPointerLeave={() => {
            setHovered(null);
            setPointer(null);
          }}
        >
          <svg width={width} height={height} role="img" aria-label="Volume share by country">
            {arcs.map((arc) => (
              <path
                key={arc.key}
                d={arc.d}
                fill={arc.color}
                fillOpacity={hovered === null || hovered === arc.key ? 1 : 0.35}
                onPointerEnter={() => setHovered(arc.key)}
              />
            ))}
            <text
              x={width / 2}
              y={height / 2 - 6}
              textAnchor="middle"
              className="donut-center-value"
              fill={CHART_INK.primary}
            >
              {centerValue}
            </text>
            <text
              x={width / 2}
              y={height / 2 + 12}
              textAnchor="middle"
              className="donut-center-label"
              fill={CHART_INK.secondary}
            >
              {centerLabel}
            </text>
          </svg>

          {hoveredArc && pointer && (
            <ChartTooltip
              x={pointer.x}
              y={pointer.y}
              width={width}
              height={height}
              title={hoveredArc.label}
              rows={[
                { label: unitLabel, value: formatValue(hoveredArc.value), color: hoveredArc.color },
                { label: "Share", value: `${(hoveredArc.share * 100).toFixed(1)}%` },
              ]}
            />
          )}
        </div>
      )}
      {legendItems.length > 0 && <Legend items={legendItems} onHover={setHovered} />}
    </div>
  );
}
