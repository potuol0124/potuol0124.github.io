/** 한국 표준시(KST, UTC+9) 기준 시간 계산. 서머타임이 없어서 고정 오프셋으로 충분해요. */
export const KST_OFFSET = 9 * 3600_000;
export const HOUR = 3600_000;
export const DAY = 24 * HOUR;

const pad = (n: number, w = 2) => String(n).padStart(w, '0');

/** KST 기준 해당 날짜 00:00의 UTC ms */
export function kstDayStart(t: number): number {
  return Math.floor((t + KST_OFFSET) / DAY) * DAY - KST_OFFSET;
}

export function kstNextMidnight(t: number): number {
  return kstDayStart(t) + DAY;
}

/** KST 정시의 UTC ms */
export function kstHourStart(t: number): number {
  return Math.floor(t / HOUR) * HOUR; // KST 오프셋이 정수 시간이라 UTC 정시와 같아요
}

export interface KstParts {
  y: number;
  m: number;
  d: number;
  h: number;
  min: number;
  /** 0=일 ~ 6=토 */
  dow: number;
}

export function kstParts(t: number): KstParts {
  const d = new Date(t + KST_OFFSET);
  return {
    y: d.getUTCFullYear(),
    m: d.getUTCMonth() + 1,
    d: d.getUTCDate(),
    h: d.getUTCHours(),
    min: d.getUTCMinutes(),
    dow: d.getUTCDay(),
  };
}

/** 'YYYYMMDD' */
export function kstDayKey(t: number): string {
  const p = kstParts(t);
  return `${p.y}${pad(p.m)}${pad(p.d)}`;
}

/** 'YYYYMM' */
export function kstMonthKey(t: number): string {
  const p = kstParts(t);
  return `${p.y}${pad(p.m)}`;
}

/** 'DDHH' — 월별 히스토리 문서 안의 키 */
export function kstDayHourKey(t: number): string {
  const p = kstParts(t);
  return `${pad(p.d)}${pad(p.h)}`;
}

/** 'HHmm' (기상청 base_time) */
export function kstHHmm(t: number): string {
  const p = kstParts(t);
  return `${pad(p.h)}${pad(p.min)}`;
}

/** 'YYYY-MM-DD' */
export function kstIsoDate(t: number): string {
  const p = kstParts(t);
  return `${p.y}-${pad(p.m)}-${pad(p.d)}`;
}

/** 월요일 00시 시작 주의 키 (그 월요일의 YYYYMMDD) */
export function kstWeekKey(t: number): string {
  const start = kstWeekStart(t);
  return kstDayKey(start);
}

export function kstWeekStart(t: number): number {
  const dayStart = kstDayStart(t);
  const dow = kstParts(t).dow; // 0=일
  const sinceMonday = (dow + 6) % 7;
  return dayStart - sinceMonday * DAY;
}

/** 'YYYYMMDDHHmm' 형식(기상청 fcstDate+fcstTime)을 UTC ms로 */
export function parseKst(date: string, time = '0000'): number {
  const y = Number(date.slice(0, 4));
  const m = Number(date.slice(4, 6));
  const d = Number(date.slice(6, 8));
  const h = Number(time.slice(0, 2));
  const min = Number(time.slice(2, 4));
  return Date.UTC(y, m - 1, d, h, min) - KST_OFFSET;
}
