// 근처 식당 검색 핵심 로직. Deno 전역에 의존하지 않아서 Node에서도 테스트할 수 있어요.
//
// - 장소 목록: 카카오 로컬 API (무료 쿼터, 국내 데이터가 가장 풍부)
// - 별점: Google Places API (New) Text Search 한 번으로 주변 가게 별점을 받아서
//         이름·거리로 카카오 장소와 짝지어요. 키가 없으면 별점 없이 동작해요.

export type StyleId =
  | 'korean'
  | 'chinese'
  | 'japanese'
  | 'western'
  | 'snack'
  | 'asian'
  | 'meat'
  | 'chicken'
  | 'pizza'
  | 'burger'
  | 'bar'
  | 'cafe';

interface StyleDef {
  /** 카카오 카테고리 그룹: FD6 음식점, CE7 카페 */
  group: 'FD6' | 'CE7';
  /** 카카오 키워드 검색어 */
  query: string;
  /** 카카오 category_name 이 이 스타일에 속하는지 */
  match: RegExp;
  /** 구글 Text Search 검색어 */
  google: string;
}

// 순서가 중요해요: 분류할 때 위에서부터 먼저 맞는 스타일로 정해요.
// (예: "음식점 > 한식 > 육류,고기" 는 한식보다 고기·구이로, "양식 > 피자" 는 피자로)
export const STYLES: Record<StyleId, StyleDef> = {
  cafe: { group: 'CE7', query: '카페', match: /카페|디저트|제과|베이커리|아이스크림|도넛|떡,한과/, google: '카페' },
  bar: { group: 'FD6', query: '술집', match: />\s*술집/, google: '술집' },
  chicken: { group: 'FD6', query: '치킨', match: />\s*치킨/, google: '치킨' },
  pizza: { group: 'FD6', query: '피자', match: /피자/, google: '피자' },
  burger: { group: 'FD6', query: '햄버거', match: /햄버거|패스트푸드/, google: '햄버거' },
  meat: { group: 'FD6', query: '고기집', match: /육류,고기|곱창|막창|갈비|삼겹살|양꼬치/, google: '고깃집' },
  snack: { group: 'FD6', query: '분식', match: />\s*분식/, google: '분식' },
  korean: { group: 'FD6', query: '한식', match: />\s*한식/, google: '한식' },
  chinese: { group: 'FD6', query: '중식', match: />\s*중식/, google: '중식' },
  japanese: { group: 'FD6', query: '일식', match: />\s*일식/, google: '일식' },
  asian: { group: 'FD6', query: '아시아음식', match: />\s*아시아음식/, google: '아시아 음식' },
  western: { group: 'FD6', query: '양식', match: />\s*양식/, google: '양식' },
};

export const STYLE_IDS = Object.keys(STYLES) as StyleId[];

export function classify(categoryPath: string): StyleId | null {
  for (const id of STYLE_IDS) if (STYLES[id].match.test(categoryPath)) return id;
  return null;
}

export interface Place {
  id: string;
  name: string;
  category: string;
  categoryPath: string;
  style: StyleId | null;
  distance: number;
  lat: number;
  lng: number;
  address: string;
  phone: string;
  url: string;
  rating?: number;
  ratingCount?: number;
  ratingUrl?: string;
}

export interface NearbyParams {
  lat: number;
  lng: number;
  radius: number;
  styles: StyleId[];
  sort: 'distance' | 'rating';
}

export interface Keys {
  kakao: string;
  google?: string;
}

// ---------------------------------------------------------------- 입력 검증

export function parseParams(url: URL): NearbyParams | string {
  const lat = Number(url.searchParams.get('lat'));
  const lng = Number(url.searchParams.get('lng'));
  const radius = Math.round(Number(url.searchParams.get('radius') ?? 1000));
  // 대한민국 대략 범위 밖이면 거절 (카카오 데이터도 국내만 있어요)
  if (!(lat >= 33 && lat <= 39 && lng >= 124 && lng <= 132)) return '국내 위치에서만 검색할 수 있어요';
  if (!(radius >= 100 && radius <= 5000)) return 'radius 는 100~5000m 사이여야 해요';

  const raw = (url.searchParams.get('styles') ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  const styles = [...new Set(raw)].filter((s): s is StyleId => s in STYLES);
  if (styles.length !== new Set(raw).size) return '알 수 없는 음식 종류가 있어요';

  const sort = url.searchParams.get('sort') === 'rating' ? 'rating' : 'distance';
  return { lat, lng, radius, styles, sort };
}

// ---------------------------------------------------------------- 카카오

interface KakaoDoc {
  id: string;
  place_name: string;
  category_name: string;
  category_group_code: string;
  phone: string;
  address_name: string;
  road_address_name: string;
  x: string;
  y: string;
  place_url: string;
  distance: string;
}

interface KakaoRes {
  meta: { is_end: boolean; pageable_count: number };
  documents: KakaoDoc[];
}

export class UpstreamError extends Error {}

async function kakaoPage(
  keys: Keys,
  endpoint: 'category' | 'keyword',
  params: Record<string, string>,
  page: number,
): Promise<KakaoRes> {
  const qs = new URLSearchParams({ ...params, page: String(page), size: '15', sort: 'distance' });
  const res = await fetch(`https://dapi.kakao.com/v2/local/search/${endpoint}.json?${qs}`, {
    headers: { Authorization: `KakaoAK ${keys.kakao}` },
    signal: AbortSignal.timeout(5000),
  }).catch((e) => {
    throw new UpstreamError(`kakao network: ${e instanceof Error ? e.message : e}`);
  });
  if (!res.ok) throw new UpstreamError(`kakao ${res.status}: ${await res.text().catch(() => '')}`);
  return res.json();
}

/** 카카오는 검색어 하나당 최대 45개(15개 × 3페이지)까지 돌려줘요. */
async function kakaoSearch(
  keys: Keys,
  endpoint: 'category' | 'keyword',
  params: Record<string, string>,
  maxPages: number,
): Promise<KakaoDoc[]> {
  const first = await kakaoPage(keys, endpoint, params, 1);
  if (first.meta.is_end || maxPages <= 1) return first.documents;
  const lastPage = Math.min(maxPages, Math.ceil(first.meta.pageable_count / 15));
  const rest = await Promise.all(
    Array.from({ length: Math.max(0, lastPage - 1) }, (_, i) => kakaoPage(keys, endpoint, params, i + 2)),
  );
  return [first, ...rest].flatMap((r) => r.documents);
}

function toPlace(d: KakaoDoc): Place {
  const parts = d.category_name.split('>').map((s) => s.trim());
  return {
    id: d.id,
    name: d.place_name,
    category: parts[parts.length - 1] || parts[0] || '',
    categoryPath: d.category_name,
    style: classify(d.category_name),
    distance: Number(d.distance) || 0,
    lat: Number(d.y),
    lng: Number(d.x),
    address: d.road_address_name || d.address_name,
    phone: d.phone,
    url: d.place_url,
  };
}

export async function searchKakao(keys: Keys, p: NearbyParams): Promise<Place[]> {
  const base = { x: String(p.lng), y: String(p.lat), radius: String(p.radius) };

  let docs: KakaoDoc[];
  if (p.styles.length === 0) {
    docs = await kakaoSearch(keys, 'category', { ...base, category_group_code: 'FD6' }, 3);
  } else {
    // 고른 종류가 많을수록 종류당 페이지 수를 줄여서 호출 수를 제한해요.
    const pages = p.styles.length <= 2 ? 3 : p.styles.length <= 4 ? 2 : 1;
    const lists = await Promise.all(
      p.styles.map(async (id) => {
        const s = STYLES[id];
        const found = await kakaoSearch(
          keys,
          'keyword',
          { ...base, query: s.query, category_group_code: s.group },
          pages,
        );
        // 검색어가 가게 이름에만 걸린 경우를 걸러내요 (예: "치킨" 이 들어간 한식집)
        return found.filter((d) => s.match.test(d.category_name));
      }),
    );
    docs = lists.flat();
  }

  const byId = new Map<string, Place>();
  for (const d of docs) if (!byId.has(d.id)) byId.set(d.id, toPlace(d));
  let places = [...byId.values()].filter((pl) => pl.distance <= p.radius);
  if (p.styles.length > 0) {
    // 여러 종류에 걸치는 가게는 고른 종류 중 하나로 표시해요.
    places = places.map((pl) =>
      pl.style && p.styles.includes(pl.style)
        ? pl
        : { ...pl, style: p.styles.find((id) => STYLES[id].match.test(pl.categoryPath)) ?? pl.style },
    );
  }
  return places.sort((a, b) => a.distance - b.distance);
}

// ---------------------------------------------------------------- 구글 별점

interface GooglePlace {
  id: string;
  displayName?: { text: string };
  location?: { latitude: number; longitude: number };
  rating?: number;
  userRatingCount?: number;
  googleMapsUri?: string;
}

function boundingBox(lat: number, lng: number, radius: number) {
  const dLat = radius / 111_320;
  const dLng = radius / (111_320 * Math.cos((lat * Math.PI) / 180));
  return {
    low: { latitude: lat - dLat, longitude: lng - dLng },
    high: { latitude: lat + dLat, longitude: lng + dLng },
  };
}

async function googleTextSearch(key: string, textQuery: string, p: NearbyParams): Promise<GooglePlace[]> {
  const res = await fetch('https://places.googleapis.com/v1/places:searchText', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': key,
      // 필요한 필드만 요청해요 (필드에 따라 요금 등급이 달라져요)
      'X-Goog-FieldMask':
        'places.id,places.displayName,places.location,places.rating,places.userRatingCount,places.googleMapsUri',
    },
    body: JSON.stringify({
      textQuery,
      languageCode: 'ko',
      regionCode: 'KR',
      pageSize: 20,
      rankPreference: 'DISTANCE',
      locationRestriction: { rectangle: boundingBox(p.lat, p.lng, p.radius) },
    }),
    signal: AbortSignal.timeout(5000),
  });
  if (!res.ok) throw new UpstreamError(`google ${res.status}: ${await res.text().catch(() => '')}`);
  const json = (await res.json()) as { places?: GooglePlace[] };
  return json.places ?? [];
}

/** 검색 한 번에 구글 호출은 최대 2번이에요. */
export function googleQueries(styles: StyleId[]): string[] {
  if (styles.length === 0 || styles.length > 2) return ['음식점'];
  return styles.map((id) => STYLES[id].google);
}

export function normalizeName(name: string): string {
  const cleaned = name
    .normalize('NFKC')
    .toLowerCase()
    .replace(/\(.*?\)|\[.*?\]/g, ' ')
    .trim();
  const parts = cleaned.split(/\s+/);
  // "김밥천국 강남역점" → "김밥천국" (지점명 제거)
  if (parts.length > 1 && /(점|호점|지점|본점|직영점)$/.test(parts[parts.length - 1])) parts.pop();
  return parts.join('').replace(/[^\p{L}\p{N}]/gu, '');
}

function bigrams(s: string): Map<string, number> {
  const m = new Map<string, number>();
  for (let i = 0; i < s.length - 1; i++) {
    const g = s.slice(i, i + 2);
    m.set(g, (m.get(g) ?? 0) + 1);
  }
  return m;
}

export function nameSimilarity(a: string, b: string): number {
  if (!a || !b) return 0;
  if (a === b) return 1;
  if (Math.min(a.length, b.length) >= 2 && (a.includes(b) || b.includes(a))) return 0.9;
  const A = bigrams(a);
  const B = bigrams(b);
  let inter = 0;
  for (const [g, n] of A) inter += Math.min(n, B.get(g) ?? 0);
  const total = Math.max(1, a.length - 1 + (b.length - 1));
  return (2 * inter) / total;
}

export function haversine(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6_371_000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

const MATCH_MAX_METERS = 150;
const MATCH_MIN_SIMILARITY = 0.6;

/** 이름이 비슷하고 150m 안에 있는 구글 장소의 별점을 카카오 장소에 붙여요. 한 장소는 한 번만 짝지어요. */
export function attachRatings(places: Place[], google: GooglePlace[]): Place[] {
  const candidates: { pi: number; gi: number; score: number }[] = [];
  const gNames = google.map((g) => normalizeName(g.displayName?.text ?? ''));

  places.forEach((pl, pi) => {
    const pn = normalizeName(pl.name);
    google.forEach((g, gi) => {
      if (g.rating == null || !g.location) return;
      const d = haversine(pl.lat, pl.lng, g.location.latitude, g.location.longitude);
      if (d > MATCH_MAX_METERS) return;
      const sim = nameSimilarity(pn, gNames[gi]);
      if (sim < MATCH_MIN_SIMILARITY) return;
      candidates.push({ pi, gi, score: sim - d / 1000 });
    });
  });

  candidates.sort((a, b) => b.score - a.score);
  const usedP = new Set<number>();
  const usedG = new Set<number>();
  const out = places.slice();
  for (const c of candidates) {
    if (usedP.has(c.pi) || usedG.has(c.gi)) continue;
    usedP.add(c.pi);
    usedG.add(c.gi);
    const g = google[c.gi];
    out[c.pi] = { ...out[c.pi], rating: g.rating, ratingCount: g.userRatingCount, ratingUrl: g.googleMapsUri };
  }
  return out;
}

// ---------------------------------------------------------------- 진입점

export interface NearbyResult {
  places: Place[];
  ratingsEnabled: boolean;
}

export async function nearby(keys: Keys, p: NearbyParams): Promise<NearbyResult> {
  const kakaoP = searchKakao(keys, p);
  // 구글은 실패해도 별점만 빠지고 검색은 계속돼요.
  const googleP: Promise<GooglePlace[]> = keys.google
    ? Promise.all(googleQueries(p.styles).map((q) => googleTextSearch(keys.google!, q, p)))
        .then((lists) => lists.flat())
        .catch((e) => {
          console.error('google ratings failed', e instanceof Error ? e.message : e);
          return [];
        })
    : Promise.resolve([]);

  const [places, google] = await Promise.all([kakaoP, googleP]);
  const rated = google.length ? attachRatings(places, google) : places;

  if (p.sort === 'rating') {
    rated.sort((a, b) => (b.rating ?? -1) - (a.rating ?? -1) || a.distance - b.distance);
  }
  return { places: rated, ratingsEnabled: Boolean(keys.google) };
}
