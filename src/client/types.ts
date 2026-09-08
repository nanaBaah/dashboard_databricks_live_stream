export interface LiveTrade {
  trade_id: string;
  product_key: string | null;
  eic: string | null;
  side: string | null;
  /** NUMERIC(12,2) — serialised as string by node-postgres */
  price_eur_mwh: string | null;
  /** NUMERIC(12,3) — serialised as string by node-postgres */
  volume_mw: string | null;
  currency: string | null;
  traded_ts: string | null;
  ingestion_timestamp: string;
  kafka_timestamp: string | null;
}

/** Status of a polling data source (Lakebase or UC). */
export type PollStatus = "connecting" | "live" | "error";
