/**
 * The five dashboard panels. Each one pairs a chart with the table view that
 * carries the same values, and every panel reads the single filtered slice
 * returned by `/api/monitor/overview`.
 */

import { useMemo } from "react";

import type { OverviewResponse } from "../../../shared/monitor_contract.js";
import { DonutChart } from "../charts/DonutChart.js";
import { LineChart, type LineSeries } from "../charts/LineChart.js";
import { ScatterChart, type ScatterPoint } from "../charts/ScatterChart.js";
import {
  NEUTRAL_SERIES,
  OTHER_COUNTRY,
  SERIES_COLORS,
  countryColor,
  sideColor,
} from "../charts/palette.js";
import {
  formatAxisNumber,
  formatBucket,
  formatContract,
  formatCount,
  formatInstant,
  formatPrice,
  formatVolume,
  makeTickFormatter,
} from "./format.js";
import { Panel } from "./Panel.js";

const CHART_HEIGHT = 240;

export interface PanelProps {
  data: OverviewResponse;
  /** Stable country -> hue map, keyed off the range-scoped dimension ranking. */
  colors: Map<string, string>;
  dimmed: boolean;
}

/** Shared subtitle fragment. Kept short so it never wraps to a second line. */
function bucketNote(data: OverviewResponse): string {
  return `${formatBucket(data.range.bucketSeconds)} buckets`;
}

function spanSeconds(data: OverviewResponse): number {
  return (Date.parse(data.range.to) - Date.parse(data.range.from)) / 1_000;
}

export function VwapOverTimePanel({ data, dimmed }: PanelProps) {
  const tick = useMemo(() => makeTickFormatter(spanSeconds(data)), [data]);
  const series: LineSeries[] = [
    {
      key: "vwap",
      label: "VWAP",
      color: SERIES_COLORS[0],
      points: data.tradedSeries.map((point) => ({ x: point.t, y: point.vwap })),
    },
  ];

  return (
    <Panel
      title="VWAP over time"
      subtitle={`By execution time · ${bucketNote(data)}`}
      dimmed={dimmed}
      table={{
        columns: ["Traded", "VWAP (EUR/MWh)", "Avg price", "Volume (MW)", "Trades"],
        rows: data.tradedSeries.map((point) => [
          formatInstant(point.t),
          formatPrice(point.vwap),
          formatPrice(point.avgPrice),
          formatVolume(point.volume),
          formatCount(point.trades),
        ]),
      }}
    >
      <LineChart
        series={series}
        height={CHART_HEIGHT}
        bucketSeconds={data.range.bucketSeconds}
        formatTick={tick}
        formatInstant={formatInstant}
        formatAxis={formatAxisNumber}
        formatValue={formatPrice}
        directLabels={false}
        yUnit="EUR/MWh"
        extraRows={(x) => {
          const point = data.tradedSeries.find((entry) => entry.t === x);
          if (!point) return [];
          return [
            { label: "Volume (MW)", value: formatVolume(point.volume) },
            { label: "Trades", value: formatCount(point.trades) },
          ];
        }}
      />
    </Panel>
  );
}

export function CountryVolumePanel({ data, colors, dimmed }: PanelProps) {
  const segments = useMemo(() => {
    const top = new Set(data.topCountries);
    const named = data.countries.filter((entry) => top.has(entry.country) && entry.volume > 0);
    const otherVolume = data.countries
      .filter((entry) => !top.has(entry.country))
      .reduce((sum, entry) => sum + entry.volume, 0);

    const result = named.map((entry) => ({
      key: entry.country,
      label: entry.country,
      color: countryColor(colors, entry.country),
      value: entry.volume,
    }));
    if (otherVolume > 0) {
      result.push({ key: OTHER_COUNTRY, label: OTHER_COUNTRY, color: NEUTRAL_SERIES, value: otherVolume });
    }
    return result;
  }, [colors, data.countries, data.topCountries]);

  const totalVolume = data.kpis.volume;

  return (
    <Panel
      title="Volume share by country"
      subtitle={
        data.topCountries.length > 0
          ? `Traded volume · top ${data.topCountries.length} plus "Other"`
          : "Traded volume by country"
      }
      dimmed={dimmed}
      table={{
        columns: ["Country", "Volume (MW)", "Share", "VWAP (EUR/MWh)", "Trades"],
        rows: data.countries.map((entry) => [
          entry.country,
          formatVolume(entry.volume),
          totalVolume > 0 ? `${((entry.volume / totalVolume) * 100).toFixed(1)}%` : "—",
          formatPrice(entry.vwap),
          formatCount(entry.trades),
        ]),
      }}
    >
      <DonutChart
        segments={segments}
        height={CHART_HEIGHT}
        centerValue={formatVolume(totalVolume)}
        centerLabel="MW total"
        formatValue={formatVolume}
        unitLabel="Volume (MW)"
      />
    </Panel>
  );
}

export function DeliveryVwapPanel({ data, colors, dimmed }: PanelProps) {
  const tick = useMemo(() => makeTickFormatter(spanSeconds(data)), [data]);

  const series: LineSeries[] = data.deliveryByCountry.map((entry) => ({
    key: entry.country,
    label: entry.country,
    color: countryColor(colors, entry.country),
    points: entry.points.map((point) => ({ x: point.t, y: point.vwap })),
  }));

  const rows = data.deliveryByCountry.flatMap((entry) =>
    entry.points.map((point) => [
      formatInstant(point.t),
      entry.country,
      formatPrice(point.vwap),
      formatVolume(point.volume),
      formatCount(point.trades),
    ]),
  );

  return (
    <Panel
      title="VWAP by country"
      subtitle={`By delivery period · ${bucketNote(data)}`}
      dimmed={dimmed}
      table={{
        columns: ["Delivery", "Country", "VWAP (EUR/MWh)", "Volume (MW)", "Trades"],
        rows,
        numericFrom: 2,
      }}
    >
      <LineChart
        series={series}
        height={CHART_HEIGHT}
        bucketSeconds={data.range.bucketSeconds}
        formatTick={tick}
        formatInstant={formatInstant}
        formatAxis={formatAxisNumber}
        formatValue={formatPrice}
        yUnit="EUR/MWh"
      />
    </Panel>
  );
}

export function PriceEnvelopePanel({ data, dimmed }: PanelProps) {
  const tick = useMemo(() => makeTickFormatter(spanSeconds(data)), [data]);

  const series: LineSeries[] = [
    {
      key: "vwap",
      label: "VWAP",
      color: SERIES_COLORS[0],
      points: data.deliveryEnvelope.map((point) => ({ x: point.t, y: point.vwap })),
    },
  ];

  return (
    <Panel
      title="Price range by delivery period"
      subtitle={`VWAP inside the min–max envelope · ${bucketNote(data)}`}
      dimmed={dimmed}
      table={{
        columns: ["Delivery", "Min", "VWAP", "Max", "Volume (MW)", "Trades"],
        rows: data.deliveryEnvelope.map((point) => [
          formatInstant(point.t),
          formatPrice(point.minPrice),
          formatPrice(point.vwap),
          formatPrice(point.maxPrice),
          formatVolume(point.volume),
          formatCount(point.trades),
        ]),
      }}
    >
      <LineChart
        series={series}
        band={{
          label: "Min–max range",
          color: SERIES_COLORS[0],
          points: data.deliveryEnvelope.map((point) => ({
            x: point.t,
            lo: point.minPrice,
            hi: point.maxPrice,
          })),
        }}
        height={CHART_HEIGHT}
        bucketSeconds={data.range.bucketSeconds}
        formatTick={tick}
        formatInstant={formatInstant}
        formatAxis={formatAxisNumber}
        formatValue={formatPrice}
        directLabels={false}
        yUnit="EUR/MWh"
        extraRows={(x) => {
          const point = data.deliveryEnvelope.find((entry) => entry.t === x);
          if (!point) return [];
          return [
            { label: "Max", value: formatPrice(point.maxPrice) },
            { label: "Min", value: formatPrice(point.minPrice) },
            { label: "Volume (MW)", value: formatVolume(point.volume) },
          ];
        }}
      />
    </Panel>
  );
}

export function ProductScatterPanel({ data, dimmed }: PanelProps) {
  // A contract whose trades carried no price has no y value — drop it rather
  // than plotting it at zero, which would read as "traded at 0 EUR/MWh".
  const points: ScatterPoint[] = data.products
    .filter((product) => product.avgPrice !== null)
    .map((product) => {
      const label = formatContract(
        product.country,
        product.deliveryStartMs,
        product.deliveryEndMs,
        product.productKey,
      );
      return {
        key: `${product.productKey}|${product.side ?? ""}`,
        x: product.volume,
        y: product.avgPrice as number,
        color: sideColor(product.side),
        title: label,
        rows: [
          { label: "Side", value: product.side ?? "—", color: sideColor(product.side) },
          { label: "Avg price (EUR/MWh)", value: formatPrice(product.avgPrice) },
          { label: "VWAP (EUR/MWh)", value: formatPrice(product.vwap) },
          { label: "Volume (MW)", value: formatVolume(product.volume) },
          { label: "Trades", value: formatCount(product.trades) },
          { label: "Product", value: product.productType },
        ],
      };
    });

  const shown = points.length;
  const subtitle =
    shown < data.productsTotal
      ? `Per contract and side · top ${shown.toLocaleString()} of ${data.productsTotal.toLocaleString()} by volume`
      : `Per contract and side · ${shown.toLocaleString()} contracts`;

  return (
    <Panel
      title="Avg price vs volume by contract"
      subtitle={subtitle}
      dimmed={dimmed}
      table={{
        columns: ["Contract", "Side", "Product", "Volume (MW)", "Avg price", "Trades"],
        rows: data.products.map((product) => [
          formatContract(product.country, product.deliveryStartMs, product.deliveryEndMs, product.productKey),
          product.side ?? "—",
          product.productType,
          formatVolume(product.volume),
          formatPrice(product.avgPrice),
          formatCount(product.trades),
        ]),
        numericFrom: 3,
      }}
    >
      <ScatterChart
        points={points}
        height={CHART_HEIGHT}
        legend={[
          { key: "BUY", label: "BUY", color: sideColor("BUY") },
          { key: "SELL", label: "SELL", color: sideColor("SELL") },
        ]}
        formatX={formatAxisNumber}
        formatY={formatAxisNumber}
        xUnit="Volume (MW)"
        yUnit="Avg price (EUR/MWh)"
      />
    </Panel>
  );
}
