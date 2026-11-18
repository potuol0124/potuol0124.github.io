/**
 * 기상청 단기예보 조회서비스 (공공데이터포털 VilageFcstInfoService_2.0)
 * - getUltraSrtNcst: 초단기실황 (매시 정각 관측, 매시 40분 이후 제공)
 * - getUltraSrtFcst: 초단기예보 (매시 30분 발표, 45분 이후 제공, 6시간 앞까지)
 */
import { parseKst, kstDayKey, kstHHmm, HOUR } from '../../../shared/time';
import type { ForecastPoint } from '../../../shared/types';
import type { MetricId } from '../../../shared/metrics';
import { fetchJson } from './http';

const BASE = 'https://apis.data.go.kr/1360000/VilageFcstInfoService_2.0';

/** 기상청 카테고리 → 우리 지표 */
const CATEGORY: Record<string, MetricId> = { T1H: 'temp', RN1: 'rain', REH: 'humid', WSD: 'wind' };

interface KmaItem {
  category: string;
  obsrValue?: string;
  fcstDate?: string;
  fcstTime?: string;
  fcstValue?: string;
}

interface KmaResponse {
  response?: {
    header?: { resultCode?: string; resultMsg?: string };
    body?: { items?: { item?: KmaItem[] } };
  };
}

/** "강수없음", "1mm 미만", "3.0mm", "30.0~50.0mm", "50.0mm 이상" → mm */
export function parseRain(raw: string | undefined): number {
  if (!raw) return 0;
  const s = raw.trim();
  if (s === '강수없음' || s === '0' || s === '-') return 0;
  if (s.includes('미만')) return 0.5;
  const range = s.match(/([\d.]+)\s*~\s*([\d.]+)/);
  if (range) return (Number(range[1]) + Number(range[2])) / 2;
  const n = Number(s.replace(/[^\d.]/g, ''));
  return Number.isFinite(n) ? n : 0;
}

function parseValue(category: string, raw: string | undefined): number | null {
  if (raw == null) return null;
  if (category === 'RN1') return parseRain(raw);
  const n = Number(raw);
  // 기상청 결측값은 +900 이상 또는 -900 이하
  if (!Number.isFinite(n) || n >= 900 || n <= -900) return null;
  return n;
}

async function call(op: string, key: string, nx: number, ny: number, baseDate: string, baseTime: string): Promise<KmaItem[]> {
  const url =
    `${BASE}/${op}?serviceKey=${encodeURIComponent(key)}&pageNo=1&numOfRows=1000&dataType=JSON` +
    `&base_date=${baseDate}&base_time=${baseTime}&nx=${nx}&ny=${ny}`;
  const json = await fetchJson<KmaResponse>(url);
  const code = json.response?.header?.resultCode;
  if (code && code !== '00') throw new Error(`KMA ${op} ${code} ${json.response?.header?.resultMsg ?? ''}`);
  return json.response?.body?.items?.item ?? [];
}

/** 정시 obsHour의 실황값. 아직 없으면 한 시간 전 것을 써요. */
export async function getNowcast(key: string, nx: number, ny: number, obsHour: number): Promise<{ obsAt: number; values: Partial<Record<MetricId, number>> }> {
  for (const at of [obsHour, obsHour - HOUR]) {
    const items = await call('getUltraSrtNcst', key, nx, ny, kstDayKey(at), kstHHmm(at).slice(0, 2) + '00').catch(() => []);
    if (!items.length) continue;
    const values: Partial<Record<MetricId, number>> = {};
    for (const it of items) {
      const m = CATEGORY[it.category];
      const v = parseValue(it.category, it.obsrValue);
      if (m && v != null) values[m] = v;
    }
    return { obsAt: at, values };
  }
  return { obsAt: obsHour, values: {} };
}

/** 초단기예보 (발표 시각: obsHour의 30분, 없으면 한 시간 전) */
export async function getForecast(key: string, nx: number, ny: number, obsHour: number): Promise<Partial<Record<MetricId, ForecastPoint[]>>> {
  for (const at of [obsHour, obsHour - HOUR]) {
    const items = await call('getUltraSrtFcst', key, nx, ny, kstDayKey(at), kstHHmm(at).slice(0, 2) + '30').catch(() => []);
    if (!items.length) continue;
    const out: Partial<Record<MetricId, ForecastPoint[]>> = {};
    for (const it of items) {
      const m = CATEGORY[it.category];
      const v = parseValue(it.category, it.fcstValue);
      if (!m || v == null || !it.fcstDate || !it.fcstTime) continue;
      (out[m] ??= []).push({ t: parseKst(it.fcstDate, it.fcstTime), v });
    }
    for (const arr of Object.values(out)) arr?.sort((a, b) => a.t - b.t);
    return out;
  }
  return {};
}
