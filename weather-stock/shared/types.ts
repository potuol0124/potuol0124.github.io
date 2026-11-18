/** Firestore 문서와 앱이 공통으로 쓰는 타입. 시각은 모두 UTC epoch ms예요. */

export interface ForecastPoint {
  /** 예보 시각 */
  t: number;
  v: number;
}

export interface StockState {
  /** 가장 최근 관측값 (관측 실패 시 직전 값 유지, 한 번도 없으면 null) */
  value: number | null;
  /** 관측 기준 시각(정시) */
  obsAt: number;
  /** 가격 경로: anchorAt에 anchorPrice에서 시작해 targetAt에 targetPrice로 직선 이동 */
  anchorPrice: number;
  anchorAt: number;
  targetPrice: number;
  targetAt: number;
  /** 오늘 00시 가격 (등락률 기준) */
  dayOpen: number;
  /** 오늘 고가·저가 (정시 관측가 기준) */
  high: number;
  low: number;
  /** 앞으로 몇 시간 예보 (기상청 초단기예보). 미세먼지는 비어 있어요 */
  forecast: ForecastPoint[];
}

export interface DustForecast {
  /** 예: '좋음' | '보통' | '나쁨' | '매우나쁨' */
  today?: string;
  tomorrow?: string;
}

export interface MarketState {
  updatedAt: number;
  /** 마지막 관측 정시 */
  obsHour: number;
  stocks: Record<string, StockState>;
  /** regionId → 미세먼지 예보 등급 */
  dust: Record<string, DustForecast>;
  /** 에어코리아 예보 개황 문장 */
  dustSummary?: string;
}

export interface UserDoc {
  uid: string;
  nickname: string;
  /** 주문 가능 현금 */
  cash: number;
  /** 지정가 매수 주문에 묶인 현금 */
  reservedCash: number;
  createdAt: number;
  watchlist: string[];
  /** 마지막 평가 시점의 총자산 (랭킹용, 서버가 매시간 갱신) */
  totalAssets: number;
  /** 주간 랭킹: 이번 주 시작 시점 자산과 외부 유입(구제금 +, 환전 -) */
  weekKey: string;
  weekStartAssets: number;
  weekFlow: number;
  lastBailoutDay?: string;
  /** 오늘 환전한 포인트 */
  exchangeDay?: string;
  exchangedToday: number;
  totalDividends: number;
  totalExchangedPoints: number;
  lastDividend?: { day: string; amount: number };
}

export interface Holding {
  stockId: string;
  /** 보유 수량 (지정가 매도에 묶인 수량 포함) */
  shares: number;
  /** 지정가 매도 주문에 묶인 수량 */
  reserved: number;
  /** 평균 매수가 */
  avgPrice: number;
  /** 배당 계산용: 직전 정산 이후 누적 (보유수량 × ms) */
  accShareMs: number;
  /** accShareMs를 마지막으로 반영한 시각 */
  lastAt: number;
}

export type OrderSide = 'buy' | 'sell';
export type OrderType = 'market' | 'limit';
export type OrderStatus = 'pending' | 'filled' | 'cancelled' | 'expired';

export interface Order {
  id: string;
  stockId: string;
  side: OrderSide;
  type: OrderType;
  qty: number;
  limitPrice?: number;
  status: OrderStatus;
  createdAt: number;
  /** 지정가 주문 만료 시각(다음 00시) */
  expiresAt?: number;
  /** 지정가 매수 시 묶어 둔 현금 */
  reservedCash?: number;
  filledAt?: number;
  price?: number;
  fee?: number;
  /** 체결 금액 (수수료 제외) */
  amount?: number;
}

export type LedgerType = 'signup' | 'buy' | 'sell' | 'dividend' | 'bailout' | 'exchange' | 'refund';

export interface LedgerEntry {
  id: string;
  type: LedgerType;
  /** 현금 변화량 (+/-) */
  amount: number;
  at: number;
  memo: string;
  stockId?: string;
  qty?: number;
  price?: number;
  fee?: number;
  /** 배당·환전 등 부가 정보 */
  points?: number;
  /** 매도 실현손익 */
  profit?: number;
}

export interface RankingEntry {
  uid: string;
  nickname: string;
  totalAssets: number;
  weeklyReturn: number;
}

export interface Ranking {
  updatedAt: number;
  weekKey: string;
  weekly: RankingEntry[];
  total: RankingEntry[];
}

export type ExchangeStatus = 'reserved' | 'granted' | 'cancelled' | 'needs_review';

export interface ExchangeDoc {
  id: string;
  uid: string;
  points: number;
  coins: number;
  status: ExchangeStatus;
  createdAt: number;
  dayKey: string;
  rewardKey?: string;
  error?: string;
}

/** 차트용 시계열 점 */
export interface PricePoint {
  t: number;
  price: number;
  value?: number;
}
