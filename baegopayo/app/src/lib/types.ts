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

export type SortKey = 'distance' | 'rating';

export interface Coords {
  lat: number;
  lng: number;
}

export interface Place {
  id: string;
  name: string;
  /** 카카오 분류 마지막 단계 (예: "국밥") */
  category: string;
  /** 전체 분류 (예: "음식점 > 한식 > 해장국") */
  categoryPath: string;
  style: StyleId | null;
  /** 미터 단위 */
  distance: number;
  lat: number;
  lng: number;
  address: string;
  phone: string;
  /** 카카오맵 장소 페이지 */
  url: string;
  rating?: number;
  ratingCount?: number;
  ratingUrl?: string;
}

export interface NearbyResponse {
  places: Place[];
  /** 서버에 별점 소스(구글)가 켜져 있는지 */
  ratingsEnabled: boolean;
  /** 데모 데이터 여부 */
  demo?: boolean;
}
