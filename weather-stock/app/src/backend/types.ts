import type { Holding, LedgerEntry, MarketState, Order, OrderSide, OrderType, PricePoint, Ranking, UserDoc } from '@shared/types';

export type Unsub = () => void;

export interface Account {
  user: UserDoc;
  holdings: Record<string, Holding>;
  /** 미체결 + 최근 주문 (최신순) */
  orders: Order[];
  /** 최근 거래·배당 내역 (최신순) */
  ledger: LedgerEntry[];
}

export interface OrderRequest {
  stockId: string;
  side: OrderSide;
  type: OrderType;
  qty: number;
  limitPrice?: number;
}

export interface Backend {
  readonly mode: 'mock' | 'firebase';
  /** 로그인·계정 생성 */
  init(): Promise<void>;
  subscribeMarket(cb: (m: MarketState) => void): Unsub;
  subscribeAccount(cb: (a: Account) => void): Unsub;
  getHistory(stockId: string, from: number, to: number): Promise<PricePoint[]>;
  getRanking(): Promise<Ranking>;
  placeOrder(req: OrderRequest): Promise<Order>;
  cancelOrder(orderId: string): Promise<void>;
  toggleWatch(stockId: string): Promise<void>;
  setNickname(nickname: string): Promise<void>;
  /** 환전 1단계: 날로를 차감하고 예약 */
  requestExchange(points: number): Promise<{ exchangeId: string }>;
  /** 환전 2단계: 토스포인트 지급 성공 */
  confirmExchange(exchangeId: string, rewardKey: string): Promise<void>;
  /** 환전 2단계: 지급 실패 → 날로 환불 */
  cancelExchange(exchangeId: string, reason: string): Promise<void>;
  claimBailout(): Promise<void>;
  /** 목업 전용: 내 데이터 초기화 */
  reset?(): Promise<void>;
}
