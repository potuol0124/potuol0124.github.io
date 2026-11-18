# 날씨증권 ⛅

전국 17개 시·도 × 6개 날씨 지표(기온·미세먼지·초미세먼지·강수량·습도·풍속) = **102개 종목**을 사고파는 모의 주식 게임. 앱인토스(토스 미니앱, WebView) 출시용.

```
weather-stock/
├── shared/      앱·서버 공용 로직 (종목, 가격 산식, 체결·배당·환전 계산) ← 숫자 조정은 여기
├── app/         미니앱 (React + Vite + @apps-in-toss/web-framework)
├── functions/   Firebase Cloud Functions (날씨 수집, 00시 배당, 주문 처리, 토스 로그인)
├── firestore.rules / firestore.indexes.json / firebase.json
└── index.html, privacy.html, terms.html   GitHub Pages로 공개되는 소개·정책 페이지
```

## 바로 실행해 보기 (서버·키 없이)

```bash
cd weather-stock/app
npm install
npm run dev        # http://localhost:5173
```

기본값은 **목업 모드**예요. 가짜 날씨로 시세가 움직이고, 계정은 브라우저 localStorage에 저장돼요. 매수·매도·지정가·00시 배당·환전·구제금·랭킹(가짜 봇 40명)까지 전부 동작해요. 개발 서버에서는 `@apps-in-toss/devtools`가 토스 SDK를 흉내 내고, 오른쪽 아래 **AIT** 버튼으로 환경을 바꿔볼 수 있어요. (devtools는 Node 24 이상 권장)

## 게임 규칙 (기본값 — `shared/config.ts`에서 변경)

| 항목 | 값 |
|---|---|
| 시작 자금 | 1,000,000날로 |
| 수수료 | 매수·매도 각 0.2% |
| 배당 | 매일 00시, **지난 24시간 평균 보유 평가액**의 0.5% (막판 몰아사기 방지) |
| 환전 | 1,000날로 = 토스포인트 1P, 하루 최대 50P |
| 구제금 | 총자산 1만날로 미만일 때 하루 1회, 보상형 광고 시청 후 10만날로 |
| 지정가 | 당일 00시 만료, 최대 20개 |
| 랭킹 | 주간 수익률(월요일 00시 초기화, 구제금·환전 제외) + 총자산, 매시간 집계 |

**가격 산식** (`shared/metrics.ts`): `주가 = 기준가 × (수치 + offset) / (기준수치 + offset)` — 영하 기온·0mm에서도 가격이 양수예요. 강수량만 로그 스케일.
**시세 움직임** (`shared/market.ts`): 매시 50분에 정시 관측값이 들어오면 그 값의 가격으로 맞춰지고, 다음 1시간 동안은 기상청 초단기예보의 다음 시각 값을 향해 직선으로 움직여요. 예보가 틀린 만큼 다음 관측 때 가격이 튀어요. 미세먼지는 수치 예보가 없어 다음 관측까지 그대로예요.

## 출시까지 해야 할 일 (직접 하셔야 하는 것)

### 1. 공공데이터포털 API 키
[data.go.kr](https://www.data.go.kr)에서 아래 두 개를 **같은 계정으로** 활용신청하고 *일반 인증키(Decoding)* 를 받아요.
- 기상청_단기예보 ((구)_동네예보) 조회서비스 — 초단기실황·초단기예보 사용
- 한국환경공단_에어코리아_대기오염정보 — 시도별 실시간 측정정보, 대기질 예보통보 사용

> 에어코리아 개발계정은 하루 500회 제한이에요. 매시 17회 + 예보 24회 ≈ 432회라 빠듯하니, 운영계정 전환(트래픽 증가 신청)을 해 두세요.

### 2. Firebase
1. Firebase 프로젝트 생성 → **Blaze(종량제)** 요금제 (스케줄 함수에 필요)
2. Firestore 생성 (위치: `asia-northeast3` 서울)
3. Authentication → 로그인 방법에서 **익명**은 켜지 마세요(운영). 커스텀 토큰은 별도 설정 없이 동작해요.
4. 프로젝트 설정 → 웹 앱 추가 → 설정값을 `app/.env.firebase`에 입력 (`app/.env.example` 참고, `VITE_BACKEND=firebase`)
5. 배포
   ```bash
   cd weather-stock
   cp .firebaserc.example .firebaserc   # 프로젝트 ID 입력
   cd functions && npm install && cd ..
   npx firebase-tools functions:secrets:set DATA_GO_KR_KEY
   npx firebase-tools functions:secrets:set TOSS_MTLS_CERT < 인증서.pem
   npx firebase-tools functions:secrets:set TOSS_MTLS_KEY  < 개인키.pem
   npx firebase-tools deploy --only firestore,functions
   ```
6. 첫 시세 만들기: 배포 후 Google Cloud 콘솔 → Cloud Scheduler에서 `collectWeatherJob`을 **강제 실행**하면 바로 `market/state`가 생겨요.

### 3. 앱인토스 콘솔
- 앱 등록 → `appName`을 `app/apps-in-toss.config.ts`와 `shared/config.ts`의 값(`weather-stock`)과 맞추기
- **토스 로그인** 사용 설정 + mTLS 인증서 발급 → 위 시크릿에 등록
- **프로모션(토스포인트)** 생성 → 코드를 `VITE_TOSS_PROMOTION_CODE`에, 예산 충전. 콘솔의 1인당 지급 한도도 하루 50P에 맞춰 두세요(이중 안전장치).
- **광고** 그룹 생성 (배너 1개, 보상형 1개) → `VITE_AD_BANNER_GROUP_ID`, `VITE_AD_REWARDED_GROUP_ID`
- 빌드·업로드
  ```bash
  cd weather-stock/app
  npm run build:toss   # Firebase 모드로 vite build + ait build → weather-stock.ait
  npx ait deploy
  ```

## ⚠️ 출시 전에 꼭 확인할 것

1. **토스 로그인 API 경로** — `functions/src/toss.ts`의 `generate-token`, `login-me` 경로와 응답 형식을 앱인토스 개발자 문서와 대조하세요. (SDK 쪽 `appLogin`, `Promotion.grantReward`, 광고 API는 설치된 SDK 3.10.0 타입 정의로 확인했어요.)
2. **토스포인트 지급 방식** — 지금은 SDK의 `Promotion.grantReward`(클라이언트 호출)를 써요. 서버가 먼저 날로를 차감·예약하고, 지급 성공/실패를 다시 서버에 알리는 2단계 구조예요. 콘솔에서 **서버 간 지급 API**를 제공하면 그쪽으로 옮기는 게 더 안전해요(조작된 클라이언트가 예약 없이 직접 지급을 시도하는 걸 원천 차단).
3. **검수 정책** — 게임 화폐를 포인트로 바꾸는 구조는 사행성 검토 대상이 될 수 있어요. 앱인토스 검수 가이드(비게임/게임 분류, TDS 사용 요건, 리워드 정책)를 확인하세요. 화면은 TDS 대신 자체 컴포넌트로 토스 스타일을 맞춰 두었어요.
4. **토스 로그인 연결 끊기 콜백** — 콘솔에서 요구하면 계정 삭제용 HTTP 함수를 추가해야 해요(개인정보처리방침에 '연결 끊기 시 파기'로 적어 둠).
5. **기상청 격자·에어코리아 시도명** — `shared/regions.ts`의 시·도별 대표 격자(nx, ny)를 확인하세요.
6. **정책 페이지** — `privacy.html`, `terms.html`은 초안이에요. 시행일과 내용을 확정하세요.

## 테스트

```bash
cd weather-stock/functions
npm test                      # 경제 로직 단위 테스트
# Firestore 에뮬레이터 통합 테스트 (Java 필요)
npx firebase-tools emulators:exec --only firestore --project demo-weather-stock "npm test"
```

## 비용·규모 메모
- 시세는 문서 1개(`market/state`)를 모든 사용자가 구독하고, 가격 보간은 기기에서 계산해서 읽기 비용이 작아요.
- 차트 히스토리는 종목별 월 문서 하나(`history/{종목}_{YYYYMM}`)에 쌓여요.
- 매시간 랭킹 집계와 00시 정산은 전체 사용자를 한 함수에서 돌아요. 수만 명 이상이 되면 Cloud Tasks로 나눠 처리하세요.
- 지정가 체결 확인은 1분마다 돌아요(Cloud Scheduler 작업 3개 중 1개).
