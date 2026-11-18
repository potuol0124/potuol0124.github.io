# 배고파요 — 근처 맛집 찾기 (앱인토스 미니앱)

거리 범위와 음식 종류를 고르면 현재 위치 근처 식당을 가까운 순·별점순으로 보여주는 토스 미니앱이에요.

```
baegopayo/
├─ app/                      미니앱 (Vite + React 18 + TDS, @apps-in-toss/web-framework 3.10)
│  ├─ apps-in-toss.config.ts 앱 이름·위치 권한 설정
│  ├─ .env.example           API 주소·광고 ID 설정 예시
│  └─ src/
│     ├─ App.tsx             화면 (거리·음식 선택 → 결과 목록, 정렬, 아무거나 골라줘)
│     ├─ lib/location.ts     토스 위치 권한·현재 위치
│     ├─ lib/ads.ts          배너(TossAds) / 전면 광고(loadFullScreenAd)
│     ├─ lib/api.ts          검색 API 호출 (주소가 없으면 demo.ts 데모 데이터)
│     └─ components/         PlaceRow(식당 한 줄), BannerAd
├─ supabase/functions/nearby/ 검색 서버 (Supabase Edge Function)
│  ├─ index.ts               HTTP 입구, 시크릿 읽기
│  ├─ core.ts                카카오 검색 + 구글 별점 매칭
│  └─ core.test.ts           가짜 응답으로 돌리는 테스트
├─ index.html, privacy.html, terms.html   GitHub Pages 소개·정책 페이지
```

## 동작 방식

1. 앱이 토스 위치 권한으로 현재 위치를 한 번 가져와요 (검색 버튼을 누를 때만).
2. `nearby` 함수가 **카카오 로컬 API**로 반경 안의 식당을 찾아요.
   - 전체: 음식점 카테고리(FD6) 검색, 거리순 최대 45곳
   - 종류 선택: 종류마다 키워드 검색("한식", "일식" …) 후 카카오 분류(`음식점 > 한식 > …`)로 한 번 더 걸러요
3. `GOOGLE_PLACES_API_KEY`가 있으면 **Google Places Text Search**로 같은 범위의 가게 별점을 받아서,
   이름이 비슷하고(지점명 무시) 150m 안에 있는 카카오 장소에 별점을 붙여요. 검색 한 번에 구글 호출은 최대 2번이에요.
4. 가게를 누르면 카카오맵 장소 페이지가 열려요.

### 별점에 대해

- 카카오·네이버 공식 API는 별점을 주지 않아요. 지도 앱 화면에서 별점을 긁어오는 건 약관 위반이라 쓰지 않았어요.
- 공식 API 중에서는 **Google Places API**만 별점(`rating`, `userRatingCount`)을 줘요.
  - 별점 필드는 Enterprise 요금 등급이라 무료 사용량이 작고 그 뒤는 유료예요. 출시 전에 Google Cloud 콘솔 가격표를 꼭 확인하고,
    **API 및 서비스 → 할당량**에서 하루 요청 수 상한을 걸어두세요.
  - Google 약관상 별점은 캐시해서 저장하면 안 되고, 화면에 출처(Google 지도)를 보여줘야 해요. 앱 하단에 표시하고 있어요.
- 키를 안 넣으면 별점 없이 거리순으로만 동작해요(정렬 버튼도 숨겨져요).

## 1. 바로 화면 보기 (데모 데이터)

```bash
cd baegopayo/app
npm install
npm run dev          # http://localhost:5173 — 오른쪽 아래 AIT 패널로 위치·권한·광고를 흉내 낼 수 있어요
```

`VITE_API_URL`이 비어 있으면 가짜 식당 목록을 보여줘요(화면 위에 "데모 모드" 표시). Node 24 이상을 권장해요.

## 2. 검색 서버 배포 (Supabase)

1. [카카오 디벨로퍼스](https://developers.kakao.com)에서 앱을 만들고 **REST API 키**를 복사해요. (제품 설정에서 카카오맵/로컬 사용 설정)
2. (선택) Google Cloud에서 **Places API (New)** 를 켜고 API 키를 만들어요. 키 제한은 "Places API (New)"만 허용으로.
3. 배포:

```bash
cd baegopayo
npx supabase login
npx supabase functions deploy nearby --project-ref <프로젝트 ref>
npx supabase secrets set --project-ref <프로젝트 ref> KAKAO_REST_API_KEY=... GOOGLE_PLACES_API_KEY=...
```

4. 확인:

```bash
curl "https://<ref>.supabase.co/functions/v1/nearby?lat=37.4979&lng=127.0276&radius=500&styles=korean" \
  -H "Authorization: Bearer <anon key>"
```

테스트: `node supabase/functions/nearby/core.test.ts` (또는 `deno run core.test.ts`)

## 3. 앱 설정

`app/.env.example`을 `app/.env.local`로 복사해서 채워요.

| 변수 | 내용 |
| --- | --- |
| `VITE_API_URL` | `https://<ref>.supabase.co/functions/v1/nearby` |
| `VITE_SUPABASE_ANON_KEY` | Supabase 프로젝트의 anon(public) 키 |
| `VITE_AD_BANNER_ID` | 앱인토스 콘솔에서 만든 **배너** 광고 그룹 ID |
| `VITE_AD_INTERSTITIAL_ID` | 앱인토스 콘솔에서 만든 **전면** 광고 그룹 ID |
| `VITE_AD_INTERSTITIAL_EVERY` | 전면 광고를 몇 번째 검색마다 보여줄지 (기본 3) |

광고 ID가 비어 있으면 광고 없이 동작해요.

### 광고 배치

- 배너: 결과 6개마다 1개 + 목록 맨 아래 1개. 채워질 광고가 없으면 자리를 차지하지 않아요.
- 전면: 3번째 검색마다 1번, 미리 불러온 광고가 있을 때만. 광고가 닫힌 뒤 결과가 보여요.

## 4. 앱인토스 출시

```bash
cd baegopayo/app
npm run build        # tsc → vite build → ait build → baegopayo.ait 생성
npm run deploy       # ait deploy (콘솔 API 키 필요) — 또는 콘솔에서 .ait 파일 직접 업로드
```

출시 전 확인할 것:

- [ ] 앱인토스 콘솔에 앱 등록, `appName`을 `apps-in-toss.config.ts`와 같게 (`baegopayo`)
- [ ] 콘솔에서 광고 그룹(배너·전면) 만들고 ID를 `.env.local`에 넣기
- [ ] **위치기반서비스사업 신고** (방송통신위원회, 위치정보법). 위치를 저장하지 않아도 위치를 이용해 서비스를 제공하면 신고 대상이에요. 급해요 때 신고했다면 서비스 추가로 처리되는지 확인하세요.
- [ ] 개인정보처리방침·이용약관 URL 등록: `https://potuol0124.github.io/baegopayo/privacy.html`, `.../terms.html` — 시행일·운영자 표기 확인
- [ ] 샌드박스 앱에서 위치 권한 거부 → 다시 허용 흐름, 광고 노출 확인
