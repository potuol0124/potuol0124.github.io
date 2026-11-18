/**
 * 관측값 → 종목 상태(가격 경로) 계산.
 *
 * 매시 50분(UPDATE_MINUTE)에 서버가 정시 관측값을 받아 오면:
 *   1) 가격이 관측값에 해당하는 가격으로 바로 맞춰지고 (예보가 틀린 만큼 '점프')
 *   2) 다음 1시간 동안 기상청 초단기예보의 다음 시각 값을 향해 직선으로 움직여요 ('보간')
 * 미세먼지처럼 수치 예보가 없는 지표는 다음 관측까지 가격이 그대로예요.
 */
import { valueToPrice, type Metric } from './metrics';
import { priceAt } from './engine';
import { HOUR, kstDayStart } from './time';
import type { ForecastPoint, StockState } from './types';

export const UPDATE_MINUTE = 50;

export function nextStockState(
  prev: StockState | undefined,
  metric: Metric,
  args: { value: number | null; obsAt: number; forecast: ForecastPoint[]; now: number },
): StockState {
  const { obsAt, now } = args;
  const value = args.value ?? prev?.value ?? metric.baseValue;
  const anchorPrice = valueToPrice(metric, value);
  const next = args.forecast.find((f) => f.t > obsAt);
  const targetPrice = next ? valueToPrice(metric, next.v) : anchorPrice;

  const today = kstDayStart(now);
  let dayOpen: number;
  let high: number;
  let low: number;
  if (!prev) {
    dayOpen = anchorPrice;
    high = anchorPrice;
    low = anchorPrice;
  } else if (kstDayStart(prev.anchorAt) < today) {
    dayOpen = priceAt(prev, today);
    high = Math.max(dayOpen, anchorPrice);
    low = Math.min(dayOpen, anchorPrice);
  } else {
    dayOpen = prev.dayOpen;
    high = Math.max(prev.high, anchorPrice);
    low = Math.min(prev.low, anchorPrice);
  }

  return {
    value: args.value ?? prev?.value ?? null,
    obsAt,
    anchorPrice,
    anchorAt: now,
    targetPrice,
    targetAt: now + HOUR,
    dayOpen,
    high,
    low,
    forecast: args.forecast.filter((f) => f.t > obsAt).slice(0, 6),
  };
}

/** 등락률 (오늘 00시 대비) */
export function changeRate(price: number, base: number): number {
  return base > 0 ? (price - base) / base : 0;
}
