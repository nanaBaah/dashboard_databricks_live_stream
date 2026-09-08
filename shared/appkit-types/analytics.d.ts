/**
 * Type-safe query registry augmentation for the AppKit analytics plugin.
 * Adds compile-time types for the queries under `config/queries/`.
 */
export {};

declare module "@databricks/appkit-ui/react" {
  interface QueryRegistry {
    testtable: {
      name: "testtable";
      parameters: Record<string, never>;
      result: Array<{
        trade_id: string;
        product_key: string;
        source: string;
        eic: string;
        side: string;
        /** DECIMAL(12,2) — serialized as string over JSON. */
        price_eur_mwh: string | null;
        /** DECIMAL(12,3) — serialized as string over JSON. */
        volume_mw: string | null;
        currency: string | null;
        aggressor: string | null;
        self_trade: string | null;
        company_trade: string | null;
        traded_ts: string;
        delivery_start: string;
        delivery_end: string;
        delivery_hour: number;
        trade_date: number;
        ingestion_timestamp: string;
        kafka_partition: number | null;
        kafka_offset: number | null;
        kafka_timestamp: string | null;
      }>;
    };
    testtable_count: {
      name: "testtable_count";
      parameters: Record<string, never>;
      result: Array<{ count: number }>;
    };
  }
}
