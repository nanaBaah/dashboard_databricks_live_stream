-- Most recent row from the Kafka -> Delta live-test table.
-- Runs as the app's service principal (non-OBO). The SP needs USE_CATALOG on
-- dev_hysbox, USE_SCHEMA on dev_hysbox.telemetry, and SELECT on this table.
SELECT
  trade_id,
  product_key,
  source,
  eic,
  side,
  price_eur_mwh,
  volume_mw,
  currency,
  aggressor,
  self_trade,
  company_trade,
  traded_ts,
  delivery_start,
  delivery_end,
  delivery_hour,
  trade_date,
  ingestion_timestamp,
  kafka_partition,
  kafka_offset,
  kafka_timestamp
FROM dev_hysbox.telemetry.kr_intraday_public_trades_live_test
ORDER BY ingestion_timestamp DESC
LIMIT 1
