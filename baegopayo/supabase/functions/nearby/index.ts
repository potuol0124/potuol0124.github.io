// Supabase Edge Function: GET /functions/v1/nearby?lat=&lng=&radius=&styles=korean,japanese&sort=distance
//
// 필요한 시크릿 (supabase secrets set ...):
//   KAKAO_REST_API_KEY     필수. 카카오 디벨로퍼스 > 내 애플리케이션 > REST API 키
//   GOOGLE_PLACES_API_KEY  선택. 있으면 구글 별점을 붙여요 (유료 SKU, README 참고)
//
// 위치 좌표는 검색에만 쓰고 저장하거나 로그로 남기지 않아요.
import { UpstreamError, nearby, parseParams } from './core.ts';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
};

function json(body: unknown, status = 200, extra: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', ...CORS, ...extra },
  });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  if (req.method !== 'GET') return json({ error: 'GET 만 지원해요' }, 405);

  const kakao = Deno.env.get('KAKAO_REST_API_KEY');
  if (!kakao) return json({ error: '서버 설정이 끝나지 않았어요 (KAKAO_REST_API_KEY)' }, 500);
  const google = Deno.env.get('GOOGLE_PLACES_API_KEY') || undefined;

  const params = parseParams(new URL(req.url));
  if (typeof params === 'string') return json({ error: params }, 400);

  try {
    const result = await nearby({ kakao, google }, params);
    return json(result, 200, { 'Cache-Control': 'private, max-age=60' });
  } catch (e) {
    console.error('nearby failed', e instanceof Error ? e.message : e);
    const upstream = e instanceof UpstreamError;
    return json({ error: upstream ? '지도 서비스 응답이 없어요. 잠시 뒤 다시 시도해주세요' : '검색에 실패했어요' }, upstream ? 502 : 500);
  }
});
