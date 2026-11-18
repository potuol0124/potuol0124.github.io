/**
 * 한국환경공단 에어코리아 대기오염정보 (공공데이터포털 ArpltnInforInqireSvc)
 * - getCtprvnRltmMesureDnsty: 시도별 실시간 측정정보 → 측정소 평균을 시·도 값으로 써요
 * - getMinuDustFrcstDspth: 미세먼지 예보통보 → 오늘/내일 등급
 * 개발계정은 하루 500회 제한이 있어서 17개 시·도 × 24시간 = 408회 + 예보 몇 회로 맞춰져 있어요.
 */
import { REGIONS } from '../../../shared/regions';
import type { DustForecast } from '../../../shared/types';
import { kstIsoDate, DAY } from '../../../shared/time';
import { fetchJson } from './http';

const BASE = 'https://apis.data.go.kr/B552584/ArpltnInforInqireSvc';

interface AkResponse<T> {
  response?: {
    header?: { resultCode?: string; resultMsg?: string };
    body?: { items?: T[] };
  };
}

interface Measure {
  stationName: string;
  dataTime: string;
  pm10Value?: string;
  pm25Value?: string;
  pm10Flag?: string | null;
  pm25Flag?: string | null;
}

function avg(values: (string | undefined)[]): number | null {
  const nums = values.map((v) => Number(v)).filter((n) => Number.isFinite(n) && n >= 0);
  if (!nums.length) return null;
  return Math.round(nums.reduce((a, b) => a + b, 0) / nums.length);
}

export async function getSidoDust(key: string, sido: string): Promise<{ pm10: number | null; pm25: number | null }> {
  const url =
    `${BASE}/getCtprvnRltmMesureDnsty?serviceKey=${encodeURIComponent(key)}&returnType=json&numOfRows=200&pageNo=1` +
    `&sidoName=${encodeURIComponent(sido)}&ver=1.0`;
  const json = await fetchJson<AkResponse<Measure>>(url);
  const code = json.response?.header?.resultCode;
  if (code && code !== '00') throw new Error(`AirKorea ${code} ${json.response?.header?.resultMsg ?? ''}`);
  const items = json.response?.body?.items ?? [];
  return {
    pm10: avg(items.filter((i) => !i.pm10Flag).map((i) => i.pm10Value)),
    pm25: avg(items.filter((i) => !i.pm25Flag).map((i) => i.pm25Value)),
  };
}

interface ForecastItem {
  informCode: string;
  informData: string; // 예보 대상 날짜 YYYY-MM-DD
  informGrade: string; // "서울 : 보통,제주 : 좋음,..."
  informOverall?: string;
  dataTime?: string;
}

/** regionId → {today, tomorrow} 등급 (PM10 예보 기준) */
export async function getDustForecast(key: string, now: number): Promise<{ dust: Record<string, DustForecast>; summary?: string }> {
  const today = kstIsoDate(now);
  const tomorrow = kstIsoDate(now + DAY);
  const url =
    `${BASE}/getMinuDustFrcstDspth?serviceKey=${encodeURIComponent(key)}&returnType=json&numOfRows=100&pageNo=1` +
    `&searchDate=${today}&InformCode=PM10`;
  const json = await fetchJson<AkResponse<ForecastItem>>(url);
  const items = (json.response?.body?.items ?? []).filter((i) => i.informCode === 'PM10');
  // 같은 날짜 예보가 여러 번 발표되면 마지막(최신) 것을 써요
  const latest = (date: string) =>
    items.filter((i) => i.informData === date).sort((a, b) => (a.dataTime ?? '').localeCompare(b.dataTime ?? '')).pop();
  const parse = (item?: ForecastItem) => {
    const map: Record<string, string> = {};
    for (const part of item?.informGrade.split(',') ?? []) {
      const [name, grade] = part.split(':').map((s) => s.trim());
      if (name && grade) map[name] = grade;
    }
    return map;
  };
  const t = latest(today);
  const tm = latest(tomorrow);
  const tGrades = parse(t);
  const tmGrades = parse(tm);
  const dust: Record<string, DustForecast> = {};
  for (const r of REGIONS) {
    // 예보는 '경기북부/경기남부', '강원영서/강원영동'처럼 나뉘어 있어서 앞부분이 같은 첫 항목을 써요
    const pick = (m: Record<string, string>) => m[r.sido] ?? Object.entries(m).find(([k]) => k.startsWith(r.sido))?.[1];
    dust[r.id] = { today: pick(tGrades), tomorrow: pick(tmGrades) };
  }
  return { dust, summary: (tm ?? t)?.informOverall?.replace(/^○\s*/, '') };
}
