/**
 * 매시 50분: 날씨 수집 → 시세 갱신 → 히스토리 기록 → 랭킹 집계
 */
import { FieldValue } from 'firebase-admin/firestore';
import { METRIC_BY_ID, type MetricId } from '../../shared/metrics';
import { nextStockState } from '../../shared/market';
import { REGIONS } from '../../shared/regions';
import { STOCKS } from '../../shared/stocks';
import { kstDayHourKey, kstHourStart, kstMonthKey } from '../../shared/time';
import type { ForecastPoint, MarketState, StockState } from '../../shared/types';
import { db, pool, refs } from './db';
import { getDustForecast, getSidoDust } from './weather/airkorea';
import { getForecast, getNowcast } from './weather/kma';

interface RegionWeather {
  values: Partial<Record<MetricId, number>>;
  forecast: Partial<Record<MetricId, ForecastPoint[]>>;
}

export async function collectWeather(apiKey: string, now = Date.now()) {
  const obsHour = kstHourStart(now);
  const weather: Record<string, RegionWeather> = {};
  const failures: string[] = [];

  await pool(REGIONS, 5, async (r) => {
    const w: RegionWeather = { values: {}, forecast: {} };
    try {
      const [nc, fc] = await Promise.all([getNowcast(apiKey, r.nx, r.ny, obsHour), getForecast(apiKey, r.nx, r.ny, obsHour)]);
      Object.assign(w.values, nc.values);
      w.forecast = fc;
    } catch (e) {
      failures.push(`kma:${r.id}`);
      console.warn('KMA 실패', r.id, e);
    }
    try {
      const d = await getSidoDust(apiKey, r.sido);
      if (d.pm10 != null) w.values.pm10 = d.pm10;
      if (d.pm25 != null) w.values.pm25 = d.pm25;
    } catch (e) {
      failures.push(`air:${r.id}`);
      console.warn('에어코리아 실패', r.id, e);
    }
    weather[r.id] = w;
  });

  const prevSnap = await refs.market().get();
  const prev = prevSnap.data();

  let dust = prev?.dust ?? {};
  let dustSummary = prev?.dustSummary;
  try {
    const f = await getDustForecast(apiKey, now);
    dust = f.dust;
    dustSummary = f.summary ?? dustSummary;
  } catch (e) {
    console.warn('미세먼지 예보 실패', e);
  }

  const stocks: Record<string, StockState> = {};
  for (const s of STOCKS) {
    const w = weather[s.regionId];
    stocks[s.id] = nextStockState(prev?.stocks[s.id], METRIC_BY_ID[s.metricId], {
      value: w?.values[s.metricId] ?? null,
      obsAt: obsHour,
      forecast: w?.forecast[s.metricId] ?? [],
      now,
    });
  }

  const market: MarketState = { updatedAt: now, obsHour, stocks, dust, dustSummary };
  await refs.market().set(market);

  // 히스토리: 종목별 월 문서에 'DDHH' 키로 관측가·관측값을 쌓아요
  const month = kstMonthKey(obsHour);
  const key = kstDayHourKey(obsHour);
  const writer = db.bulkWriter();
  for (const s of STOCKS) {
    const st = stocks[s.id];
    writer.set(
      refs.history(s.id, month),
      { p: { [key]: st.anchorPrice }, ...(st.value != null ? { v: { [key]: st.value } } : {}), updatedAt: FieldValue.serverTimestamp() },
      { merge: true },
    );
  }
  await writer.close();

  if (failures.length) console.warn(`수집 실패 ${failures.length}건: ${failures.join(', ')}`);
  return { failures };
}
