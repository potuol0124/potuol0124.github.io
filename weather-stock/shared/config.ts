/**
 * 날씨증권 경제 설정값.
 * 앱(목업 모드)과 서버(Firebase Functions)가 같은 값을 쓰도록 이 파일 하나에서 관리해요.
 * 숫자를 바꾼 뒤에는 앱과 Functions를 둘 다 다시 배포해야 해요.
 */
export const ECONOMY = {
  /** 화폐 이름 */
  currencyName: '날로',
  /** 가입 시 지급하는 시작 자금 */
  startCash: 1_000_000,
  /** 매매 수수료율 (매수·매도 각각) */
  feeRate: 0.002,
  /** 00시 배당률: 지난 24시간 평균 보유 평가액의 몇 %를 줄지 */
  dividendRate: 0.005,
  /** 포인트 환전: 1포인트에 필요한 날로 */
  coinsPerPoint: 1_000,
  /** 하루 최대 환전 포인트 (KST 기준 하루) */
  dailyPointLimit: 50,
  /** 한 번에 환전할 수 있는 최소 포인트 */
  minExchangePoints: 1,
  /** 총자산이 이 값보다 적으면 구제금을 받을 수 있어요 */
  bailoutThreshold: 10_000,
  /** 구제금 금액 (하루 1회, 보상형 광고 시청 후) */
  bailoutAmount: 100_000,
  /** 한 주문의 최대 수량 */
  maxOrderQty: 100_000,
  /** 지정가 주문을 동시에 걸어둘 수 있는 최대 개수 */
  maxOpenOrders: 20,
  /** 닉네임 길이 */
  nicknameMin: 2,
  nicknameMax: 12,
  /** 관심 종목 최대 개수 */
  maxWatchlist: 30,
} as const;

export const APP = {
  name: '날씨증권',
  /** 앱인토스 콘솔에 등록한 appName (케밥-케이스) */
  appName: 'weather-stock',
} as const;
