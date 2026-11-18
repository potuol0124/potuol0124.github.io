// VITE_API_URL 이 비어 있을 때 화면을 확인하기 위한 가짜 데이터예요. 실제 가게가 아니에요.
import type { NearbyQuery } from './api';
import type { NearbyResponse, Place, StyleId } from './types';

const SAMPLES: Record<StyleId, [string, string][]> = {
  korean: [['할매순대국', '순대'], ['고향집밥', '한정식'], ['진국설렁탕', '설렁탕'], ['명동칼국수', '칼국수']],
  chinese: [['홍복반점', '중국요리'], ['만리장성', '중국요리'], ['마라공방', '마라탕']],
  japanese: [['스시하루', '초밥,롤'], ['멘야코보', '일본식라면'], ['돈카츠상회', '돈까스,우동']],
  western: [['파스타앤코', '이탈리안'], ['브런치하우스', '양식']],
  snack: [['엄마손떡볶이', '떡볶이'], ['김밥나라', '김밥']],
  asian: [['포베트남', '베트남음식'], ['타이키친', '태국음식']],
  meat: [['연탄불고기', '육류,고기'], ['삼겹살공장', '삼겹살']],
  chicken: [['바삭치킨', '치킨']],
  pizza: [['화덕피자집', '피자']],
  burger: [['수제버거랩', '햄버거']],
  bar: [['골목포차', '실내포장마차'], ['맥주창고', '호프,요리주점']],
  cafe: [['카페 온기', '커피전문점'], ['디저트39', '디저트카페']],
};

const PATH: Record<StyleId, string> = {
  korean: '음식점 > 한식',
  chinese: '음식점 > 중식',
  japanese: '음식점 > 일식',
  western: '음식점 > 양식',
  snack: '음식점 > 분식',
  asian: '음식점 > 아시아음식',
  meat: '음식점 > 한식 > 육류,고기',
  chicken: '음식점 > 치킨',
  pizza: '음식점 > 양식 > 피자',
  burger: '음식점 > 패스트푸드',
  bar: '음식점 > 술집',
  cafe: '음식점 > 카페',
};

function seeded(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

export async function demoNearby(q: NearbyQuery): Promise<NearbyResponse> {
  await new Promise((r) => setTimeout(r, 450));
  const rand = seeded(Math.round(q.lat * 1e4) * 31 + Math.round(q.lng * 1e4));
  const styles = (q.styles.length ? q.styles : (Object.keys(SAMPLES) as StyleId[])).slice();

  const places: Place[] = [];
  for (const style of styles) {
    for (const [name, category] of SAMPLES[style]) {
      const distance = Math.round(30 + rand() * (q.radius - 30));
      const angle = rand() * Math.PI * 2;
      const hasRating = rand() > 0.2;
      places.push({
        id: `demo-${style}-${name}`,
        name,
        category,
        categoryPath: `${PATH[style]} > ${category}`,
        style,
        distance,
        lat: q.lat + (Math.sin(angle) * distance) / 111_000,
        lng: q.lng + (Math.cos(angle) * distance) / 88_000,
        address: '데모 데이터 · 실제 가게가 아니에요',
        phone: '',
        url: 'https://map.kakao.com/',
        rating: hasRating ? Math.round((3.4 + rand() * 1.5) * 10) / 10 : undefined,
        ratingCount: hasRating ? Math.round(5 + rand() * 600) : undefined,
      });
    }
  }

  if (q.sort === 'rating') {
    places.sort((a, b) => (b.rating ?? -1) - (a.rating ?? -1) || a.distance - b.distance);
  } else {
    places.sort((a, b) => a.distance - b.distance);
  }
  return { places, ratingsEnabled: true, demo: true };
}
