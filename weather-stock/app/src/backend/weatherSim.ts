/**
 * 목업 모드용 가짜 날씨. 시각과 지역만으로 값이 정해지는 결정적 함수라서
 * 새로고침해도 같은 차트가 나오고, 과거 데이터도 바로 계산할 수 있어요.
 */
import type { MetricId } from '@shared/metrics';
import { REGIONS } from '@shared/regions';
import { HOUR, kstParts } from '@shared/time';

function hash(a: number, b: number, c = 0): number {
  let h = Math.imul(a | 0, 0x27d4eb2d) ^ Math.imul(b | 0, 0x165667b1) ^ Math.imul(c | 0, 0x9e3779b1);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

/** 0..1 부드러운 값 노이즈. period 시간 단위로 매듭점을 잡아 코사인 보간 */
function smooth(seed: number, hourIdx: number, period: number): number {
  const x = hourIdx / period;
  const i = Math.floor(x);
  const f = x - i;
  const a = hash(seed, i);
  const b = hash(seed, i + 1);
  const t = (1 - Math.cos(f * Math.PI)) / 2;
  return a * (1 - t) + b * t;
}

const REGION_IDX: Record<string, number> = Object.fromEntries(REGIONS.map((r, i) => [r.id, i + 1]));

const TEMP_OFFSET: Record<string, number> = {
  seoul: 0, busan: 4, daegu: 1.5, incheon: 0, gwangju: 2, daejeon: 1, ulsan: 3.5, sejong: 0.5,
  gyeonggi: -0.5, gangwon: -2.5, chungbuk: 0, chungnam: 0.5, jeonbuk: 1, jeonnam: 3, gyeongbuk: 0.5, gyeongnam: 3.5, jeju: 6,
};
const COASTAL = new Set(['busan', 'incheon', 'ulsan', 'jeju', 'jeonnam', 'gyeongnam', 'gangwon']);

function dayOfYear(t: number) {
  const p = kstParts(t);
  return (Date.UTC(p.y, p.m - 1, p.d) - Date.UTC(p.y, 0, 1)) / 86400000;
}

function rainAt(r: number, hi: number): number {
  const local = smooth(r * 31 + 7, hi, 9);
  const front = smooth(999, hi, 30);
  const x = local * 0.55 + front * 0.6;
  if (x < 0.78) return 0;
  const mm = (x - 0.78) * 45 * (0.6 + hash(r, hi, 3) * 0.8);
  return Math.round(mm * 10) / 10;
}

/** 정시(hourIdx = floor(t/1h))의 관측값 */
export function simValue(metric: MetricId, regionId: string, hourIdx: number): number {
  const r = REGION_IDX[regionId] ?? 1;
  const t = hourIdx * HOUR;
  const h = kstParts(t).h;
  switch (metric) {
    case 'temp': {
      const season = 12.5 - 14 * Math.cos((2 * Math.PI * (dayOfYear(t) - 20)) / 365);
      const daily = 4.5 * Math.cos((2 * Math.PI * (h - 15)) / 24);
      const noise = (smooth(r * 13 + 1, hourIdx, 60) - 0.5) * 6 + (smooth(r * 17 + 2, hourIdx, 7) - 0.5) * 2;
      const rainCool = rainAt(r, hourIdx) > 0 ? -1.5 : 0;
      return round(season + (TEMP_OFFSET[regionId] ?? 0) + daily + noise + rainCool, 1);
    }
    case 'humid': {
      const daily = -14 * Math.cos((2 * Math.PI * (h - 15)) / 24);
      const noise = (smooth(r * 19 + 3, hourIdx, 18) - 0.5) * 30;
      const wet = rainAt(r, hourIdx) > 0 ? 25 : 0;
      return clamp(round(58 + daily + noise + wet + (COASTAL.has(regionId) ? 6 : 0), 0), 12, 100);
    }
    case 'wind': {
      const n = smooth(r * 23 + 4, hourIdx, 10);
      const gust = smooth(r * 29 + 5, hourIdx, 3);
      const storm = smooth(777, hourIdx, 80) > 0.9 ? 6 : 0;
      return round(0.6 + n * n * 6 + gust * 1.5 + (COASTAL.has(regionId) ? 1.6 : 0) + storm, 1);
    }
    case 'pm10': {
      const national = smooth(555, hourIdx, 40);
      const local = smooth(r * 37 + 6, hourIdx, 11);
      const dust = smooth(4242, hourIdx, 120) > 0.88 ? 90 * (smooth(4243, hourIdx, 20) + 0.3) : 0;
      const washed = rainAt(r, hourIdx) > 0 ? 0.55 : 1;
      return Math.max(3, Math.round((12 + national * 55 + local * 25 + dust) * washed));
    }
    case 'pm25': {
      const pm10 = simValue('pm10', regionId, hourIdx);
      const n = smooth(r * 41 + 8, hourIdx, 6);
      return Math.max(1, Math.round(pm10 * (0.38 + n * 0.22)));
    }
    case 'rain':
      return rainAt(r, hourIdx);
  }
}

const FC_ERR: Record<MetricId, number> = { temp: 0.9, humid: 6, wind: 0.9, rain: 1.2, pm10: 0, pm25: 0 };

/** issuedHour 시점에 발표된 targetHour 예보값 (실제와 조금씩 달라요) */
export function simForecast(metric: MetricId, regionId: string, issuedHour: number, targetHour: number): number {
  const actual = simValue(metric, regionId, targetHour);
  const lead = Math.max(1, targetHour - issuedHour);
  const r = REGION_IDX[regionId] ?? 1;
  const e = (hash(r * 101 + metric.length, targetHour, issuedHour) - 0.5) * 2 * FC_ERR[metric] * Math.sqrt(lead);
  if (metric === 'rain') {
    if (actual === 0) return hash(r, targetHour, issuedHour + 9) > 0.93 ? 0.5 : 0;
    return Math.max(0, round(actual + e * Math.max(1, actual / 3), 1));
  }
  if (metric === 'humid') return clamp(round(actual + e, 0), 10, 100);
  if (metric === 'wind') return Math.max(0, round(actual + e, 1));
  return round(actual + e, 1);
}

const round = (v: number, d: number) => Math.round(v * 10 ** d) / 10 ** d;
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
