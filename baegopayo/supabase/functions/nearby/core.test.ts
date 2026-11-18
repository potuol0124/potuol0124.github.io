// 실행: deno run core.test.ts  (또는 node core.test.ts)
// 카카오·구글 응답을 가짜로 만들어 분류·이름 매칭·별점 붙이기를 확인해요.
import assert from 'node:assert/strict';
const core = await import('./core.ts');
const { classify, normalizeName, nameSimilarity, parseParams, nearby } = core;

// classify
assert.equal(classify('음식점 > 한식 > 육류,고기 > 삼겹살'), 'meat');
assert.equal(classify('음식점 > 한식 > 해장국'), 'korean');
assert.equal(classify('음식점 > 양식 > 피자 > 도미노피자'), 'pizza');
assert.equal(classify('음식점 > 패스트푸드 > 맥도날드'), 'burger');
assert.equal(classify('음식점 > 카페 > 커피전문점 > 스타벅스'), 'cafe');
assert.equal(classify('음식점 > 술집 > 호프,요리주점'), 'bar');
assert.equal(classify('음식점 > 일식 > 초밥,롤'), 'japanese');
assert.equal(classify('음식점 > 뷔페'), null);

// names
assert.equal(normalizeName('김밥천국 강남역점'), '김밥천국');
assert.equal(normalizeName('스타벅스 강남R점'), '스타벅스');
assert.equal(normalizeName('정육점'), '정육점');
assert.ok(nameSimilarity(normalizeName('김밥천국 강남역점'), normalizeName('김밥천국 강남점')) >= 0.9);
assert.ok(nameSimilarity(normalizeName('홍콩반점0410 강남점'), normalizeName('홍콩반점 0410')) >= 0.6);
assert.ok(nameSimilarity('교촌치킨', '맘스터치') < 0.6);

// params
const u = (q: string) => new URL('http://x/nearby?' + q);
assert.deepEqual(parseParams(u('lat=37.5&lng=127.0&radius=1000&styles=korean,japanese')),
  { lat: 37.5, lng: 127, radius: 1000, styles: ['korean', 'japanese'], sort: 'distance' });
assert.equal(typeof parseParams(u('lat=40.7&lng=-74&radius=1000')), 'string');
assert.equal(typeof parseParams(u('lat=37.5&lng=127&radius=99999')), 'string');
assert.equal(typeof parseParams(u('lat=37.5&lng=127&radius=1000&styles=pasta')), 'string');

// end-to-end with mocked fetch
const calls: string[] = [];
const doc = (id: string, name: string, cat: string, dist: number, dy = 0) => ({
  id, place_name: name, category_name: cat, category_group_code: 'FD6', phone: '', address_name: 'a', road_address_name: 'r',
  x: String(127.0276), y: String(37.4979 + dy), place_url: `http://place.map.kakao.com/${id}`, distance: String(dist) });
globalThis.fetch = (async (input: any, init?: any) => {
  const url = String(input); calls.push(url);
  if (url.includes('dapi.kakao.com')) {
    assert.equal(init.headers.Authorization, 'KakaoAK KK');
    const q = new URL(url).searchParams;
    const docs = q.get('query') === '한식'
      ? [doc('1', '할매순대국 본점', '음식점 > 한식 > 순대', 120), doc('2', '치킨한식당', '음식점 > 치킨', 200), doc('3', '먼집', '음식점 > 한식 > 국밥', 1500)]
      : [doc('4', '스시하루', '음식점 > 일식 > 초밥,롤', 300, 0.0001)];
    return new Response(JSON.stringify({ meta: { is_end: true, pageable_count: docs.length }, documents: docs }));
  }
  if (url.includes('places.googleapis.com')) {
    const body = JSON.parse(init.body);
    assert.equal(init.headers['X-Goog-Api-Key'], 'GG');
    assert.ok(body.locationRestriction.rectangle.low.latitude < 37.4979);
    return new Response(JSON.stringify({ places: [
      { id: 'g1', displayName: { text: '할매순대국' }, location: { latitude: 37.4980, longitude: 127.0276 }, rating: 4.4, userRatingCount: 210, googleMapsUri: 'https://maps.google.com/?cid=1' },
      { id: 'g2', displayName: { text: '스시하루 강남점' }, location: { latitude: 37.4985, longitude: 127.0276 }, rating: 4.1, userRatingCount: 50 },
      { id: 'g3', displayName: { text: '할매순대국' }, location: { latitude: 37.52, longitude: 127.0276 }, rating: 1.0, userRatingCount: 3 },
    ] }));
  }
  throw new Error('unexpected ' + url);
}) as any;

const r = await nearby({ kakao: 'KK', google: 'GG' }, { lat: 37.4979, lng: 127.0276, radius: 1000, styles: ['korean', 'japanese'], sort: 'rating' });
console.log(r.places.map((p: any) => `${p.name} ${p.style} ${p.distance}m ★${p.rating ?? '-'}(${p.ratingCount ?? '-'})`).join('\n'));
assert.equal(r.ratingsEnabled, true);
assert.deepEqual(r.places.map((p: any) => p.id), ['1', '4']); // 치킨한식당(분류 불일치), 먼집(반경 밖) 제외, 별점순
assert.equal(r.places[0].rating, 4.4);
assert.equal(r.places[1].rating, 4.1);
assert.equal(calls.filter(c => c.includes('google')).length, 2);

// no google key → no ratings, google not called
calls.length = 0;
const r2 = await nearby({ kakao: 'KK' }, { lat: 37.4979, lng: 127.0276, radius: 1000, styles: [], sort: 'distance' });
assert.equal(r2.ratingsEnabled, false);
assert.ok(calls.every(c => !c.includes('google')));
assert.ok(calls[0].includes('/category.json') && calls[0].includes('category_group_code=FD6'));
console.log('ALL OK');
