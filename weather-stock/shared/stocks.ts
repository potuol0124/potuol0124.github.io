import { METRICS, METRIC_BY_ID, type Metric, type MetricId } from './metrics';
import { REGIONS, REGION_BY_ID, type Region } from './regions';

export interface StockDef {
  /** 예: temp-seoul */
  id: string;
  metricId: MetricId;
  regionId: string;
  /** 예: 서울기온 */
  name: string;
  /** 6자리 종목코드 예: 110010 */
  code: string;
}

export const STOCKS: StockDef[] = METRICS.flatMap((m) =>
  REGIONS.map((r) => ({
    id: `${m.id}-${r.id}`,
    metricId: m.id,
    regionId: r.id,
    name: `${r.name}${m.label}`,
    code: `${r.code}${m.code}`.slice(0, 6),
  })),
);

export const STOCK_BY_ID: Record<string, StockDef> = Object.fromEntries(STOCKS.map((s) => [s.id, s]));

export function stockMetric(s: StockDef): Metric {
  return METRIC_BY_ID[s.metricId];
}

export function stockRegion(s: StockDef): Region {
  return REGION_BY_ID[s.regionId];
}

export function isStockId(id: unknown): id is string {
  return typeof id === 'string' && id in STOCK_BY_ID;
}
