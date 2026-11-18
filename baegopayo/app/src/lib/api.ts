import { demoNearby } from './demo';
import type { Coords, NearbyResponse, SortKey, StyleId } from './types';

const API_URL = import.meta.env.VITE_API_URL as string | undefined;
const ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

export const isDemo = !API_URL;

export interface NearbyQuery extends Coords {
  radius: number;
  styles: StyleId[];
  sort: SortKey;
}

export async function fetchNearby(q: NearbyQuery, signal?: AbortSignal): Promise<NearbyResponse> {
  if (!API_URL) return demoNearby(q);

  const params = new URLSearchParams({
    lat: q.lat.toFixed(6),
    lng: q.lng.toFixed(6),
    radius: String(q.radius),
    sort: q.sort,
  });
  if (q.styles.length > 0) params.set('styles', q.styles.join(','));

  const headers: Record<string, string> = {};
  if (ANON_KEY) {
    headers.apikey = ANON_KEY;
    headers.Authorization = `Bearer ${ANON_KEY}`;
  }

  const res = await fetch(`${API_URL}?${params}`, { headers, signal });
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new Error(body?.error ?? `검색에 실패했어요 (${res.status})`);
  }
  return res.json();
}
