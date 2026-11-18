import { kstParts } from '@shared/time';

export const num = (n: number) => Math.round(n).toLocaleString('ko-KR');

export const signed = (n: number) => (n > 0 ? '+' : n < 0 ? '-' : '') + num(Math.abs(n));

export function pct(r: number, digits = 2) {
  const v = r * 100;
  const s = Math.abs(v).toFixed(digits);
  const zero = Number(s) === 0;
  return `${zero ? '' : v > 0 ? '+' : '-'}${s}%`;
}

/** 등락 방향 클래스 */
export const dir = (n: number) => (n > 0 ? 'up' : n < 0 ? 'down' : 'flat');

const pad = (n: number) => String(n).padStart(2, '0');

export function hhmm(t: number) {
  const p = kstParts(t);
  return `${pad(p.h)}:${pad(p.min)}`;
}

export function mdhm(t: number) {
  const p = kstParts(t);
  return `${p.m}.${pad(p.d)} ${pad(p.h)}:${pad(p.min)}`;
}

export function md(t: number) {
  const p = kstParts(t);
  return `${p.m}월 ${p.d}일`;
}

export function hourLabel(t: number) {
  return `${kstParts(t).h}시`;
}

export function countdown(ms: number) {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${pad(Math.floor(s / 3600))}:${pad(Math.floor((s % 3600) / 60))}:${pad(s % 60)}`;
}

/** 큰 금액 짧게: 1.2억, 3,400만 */
export function compact(n: number) {
  const a = Math.abs(n);
  const sign = n < 0 ? '-' : '';
  if (a >= 1e8) return `${sign}${(a / 1e8).toFixed(a >= 1e10 ? 0 : 1).replace(/\.0$/, '')}억`;
  if (a >= 1e4) return `${sign}${num(a / 1e4)}만`;
  return sign + num(a);
}
