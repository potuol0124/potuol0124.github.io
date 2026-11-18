import type { StyleId } from './types';

export interface FoodStyle {
  id: StyleId;
  label: string;
  emoji: string;
}

// 서버(supabase/functions/nearby)의 STYLES 와 id 가 같아야 해요.
export const FOOD_STYLES: FoodStyle[] = [
  { id: 'korean', label: '한식', emoji: '🍚' },
  { id: 'chinese', label: '중식', emoji: '🥟' },
  { id: 'japanese', label: '일식', emoji: '🍣' },
  { id: 'western', label: '양식', emoji: '🍝' },
  { id: 'snack', label: '분식', emoji: '🍢' },
  { id: 'asian', label: '아시안', emoji: '🍜' },
  { id: 'meat', label: '고기·구이', emoji: '🥩' },
  { id: 'chicken', label: '치킨', emoji: '🍗' },
  { id: 'pizza', label: '피자', emoji: '🍕' },
  { id: 'burger', label: '버거', emoji: '🍔' },
  { id: 'bar', label: '술집', emoji: '🍺' },
  { id: 'cafe', label: '카페·디저트', emoji: '☕' },
];

export const STYLE_BY_ID = Object.fromEntries(FOOD_STYLES.map((s) => [s.id, s])) as Record<
  StyleId,
  FoodStyle
>;

export const RADIUS_OPTIONS = [300, 500, 1000, 2000, 3000] as const;
export type Radius = (typeof RADIUS_OPTIONS)[number];

export function radiusLabel(r: number): string {
  return r < 1000 ? `${r}m` : `${r / 1000}km`;
}

export function formatDistance(m: number): string {
  if (m < 1000) return `${Math.round(m / 10) * 10}m`;
  return `${(m / 1000).toFixed(1)}km`;
}

/** 성인 평균 보행 속도 약 4km/h (분당 67m) 기준 */
export function walkMinutes(m: number): number {
  return Math.max(1, Math.round(m / 67));
}
