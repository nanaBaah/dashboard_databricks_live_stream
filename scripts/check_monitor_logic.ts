/**
 * Assertions over the parts of the monitor that must be right by construction:
 * how a traded range is routed across the 48 h boundary, and that merging two
 * sources yields the same VWAP a single engine would have produced.
 *
 * Run with `npm test` (tsx + node:assert — the repo has no test runner).
 */

import assert from "node:assert/strict";

import { addAgg, aggFromColumns, deriveAvgPrice, deriveVwap, emptyAgg, mergeGroups } from "../src/server/monitor/aggregate.js";
import { autoBucketSeconds, parseFilters, InvalidRequestError } from "../src/server/monitor/params.js";
import { planSources, bufferBoundary } from "../src/server/monitor/plan.js";
import * as pg from "../src/server/monitor/queries_pg.js";
import * as delta from "../src/server/monitor/queries_delta.js";

const now = new Date("2026-09-08T12:00:00Z");
const hours = (h: number) => new Date(now.getTime() - h * 3_600_000);

// --- routing -----------------------------------------------------------
const live = planSources({ from: hours(6), to: now }, now);
assert.equal(live.mode, "live");
assert.deepEqual(live.windows.map((w) => w.source), ["lakebase"]);

const history = planSources({ from: hours(240), to: hours(72) }, now);
assert.equal(history.mode, "history");
assert.deepEqual(history.windows.map((w) => w.source), ["delta"]);

const hybrid = planSources({ from: hours(240), to: now }, now);
assert.equal(hybrid.mode, "hybrid");
assert.deepEqual(hybrid.windows.map((w) => w.source), ["delta", "lakebase"]);
// half-open + contiguous: no gap, no overlap
assert.equal(hybrid.windows[0]!.to.getTime(), hybrid.windows[1]!.from.getTime());
assert.equal(hybrid.windows[0]!.to.getTime(), bufferBoundary(now).getTime());
// default 48h buffer minus the 60 min safety margin
assert.equal(bufferBoundary(now).toISOString(), "2026-09-06T13:00:00.000Z");

// --- merge maths -------------------------------------------------------
// Same rows split two ways must give the same VWAP as one combined group.
const deltaRows = [{ country: "DE", trades: 2, volume: 10, pv: 1000, price_sum: 210, price_count: 2, min_price: 100, max_price: 110 }];
const lakebaseRows = [{ country: "DE", trades: 1, volume: 90, pv: 18_000, price_sum: 200, price_count: 1, min_price: 200, max_price: 200 }];
const merged = mergeGroups([deltaRows, lakebaseRows], (r) => r.country, (r) => ({ country: r.country }), aggFromColumns);
assert.equal(merged.length, 1);
const agg = merged[0]!.agg;
assert.equal(agg.trades, 3);
assert.equal(agg.volume, 100);
assert.equal(deriveVwap(agg), 190);            // (1000 + 18000) / 100
assert.equal(deriveAvgPrice(agg), 410 / 3);    // NOT the mean of the two source VWAPs
assert.equal(agg.minPrice, 100);
assert.equal(agg.maxPrice, 200);
// A naive average of per-source VWAPs would have given (100 + 200) / 2 = 150.
assert.notEqual(deriveVwap(agg), 150);
// empty groups fold to null rather than NaN / Infinity
assert.equal(deriveVwap(emptyAgg()), null);
assert.equal(deriveAvgPrice(emptyAgg()), null);
assert.equal(addAgg(emptyAgg(), agg).maxPrice, 200);

// --- bucket selection --------------------------------------------------
assert.equal(autoBucketSeconds(3_600), 60);            // 1 h  -> 1 min
assert.equal(autoBucketSeconds(24 * 3_600), 900);      // 24 h -> 15 min
assert.equal(autoBucketSeconds(30 * 86_400), 21_600);  // 30 d -> 6 h (120 points)

// --- request validation ------------------------------------------------
const filters = parseFilters({ from: "2026-09-07T00:00:00Z", to: "2026-09-08T00:00:00Z", country: "de", side: "buy" }, now);
assert.equal(filters.country, "DE");
assert.equal(filters.side, "BUY");
assert.equal(filters.productType, "");
assert.equal(filters.bucketSeconds, 900);
assert.throws(() => parseFilters({ from: "2026-09-08T00:00:00Z", to: "2026-09-07T00:00:00Z" }, now), InvalidRequestError);
assert.throws(() => parseFilters({ country: "Germany" }, now), InvalidRequestError);
assert.throws(() => parseFilters({ bucket: "7" }, now), InvalidRequestError);
assert.throws(() => parseFilters({ from: "2020-01-01T00:00:00Z", to: "2026-01-01T00:00:00Z" }, now), InvalidRequestError);

// --- generated SQL -----------------------------------------------------
const input = { from: hours(24), to: now, country: "DE", productType: "", side: "", bucketSeconds: 900 };
const pgQ = pg.tradedSeriesQuery(input);
assert.equal(pgQ.values.length, 5);
assert.match(pgQ.text, /FLOOR\(EXTRACT\(EPOCH FROM b\.traded_ts\) \/ 900\) \* 900/);
assert.match(pgQ.text, /\$3::text = ''/);
assert.match(pg.productsQuery(input).text, /LIMIT 1500/);
assert.doesNotMatch(pgQ.text, /DE/); // filter values are bound, never interpolated

const dQ = delta.tradedSeriesQuery(input);
assert.match(dQ.statement, /FLOOR\(UNIX_TIMESTAMP\(b\.traded_ts\) \/ 900\) \* 900/);
assert.equal(dQ.parameters["country"]!.value, "DE");
assert.equal(dQ.parameters["fromTs"]!.__sql_type, "TIMESTAMP");
assert.doesNotMatch(dQ.statement, /'DE'/);
assert.throws(() => pg.tradedSeriesQuery({ ...input, bucketSeconds: 0 }), /positive integer/);

console.log("all logic checks passed");
