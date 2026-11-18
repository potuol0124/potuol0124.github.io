/**
 * 순수 경제 로직. 목업 백엔드와 Firebase Functions가 똑같이 이 함수들을 써서
 * 체결·배당·환전 결과가 어느 쪽에서든 같게 나와요.
 * 모든 함수는 입력을 바꾸지 않고 새 객체를 돌려줘요.
 */
import { ECONOMY } from './config';
import type { Holding, Order, StockState, UserDoc } from './types';
import { DAY, kstDayKey, kstNextMidnight, kstWeekKey } from './time';

export class GameError extends Error {
  constructor(
    public code: string,
    message: string,
  ) {
    super(message);
  }
}

// ── 가격 ─────────────────────────────────────────────

/** 시각 t의 주가. anchor → target 사이를 직선으로 보간해요. */
export function priceAt(s: Pick<StockState, 'anchorPrice' | 'anchorAt' | 'targetPrice' | 'targetAt'>, t: number): number {
  if (t <= s.anchorAt || s.targetAt <= s.anchorAt) return s.anchorPrice;
  if (t >= s.targetAt) return s.targetPrice;
  const f = (t - s.anchorAt) / (s.targetAt - s.anchorAt);
  return Math.max(1, Math.round(s.anchorPrice + (s.targetPrice - s.anchorPrice) * f));
}

export function feeFor(amount: number): number {
  return amount <= 0 ? 0 : Math.ceil(amount * ECONOMY.feeRate);
}

/** 수량 qty를 사는 데 필요한 총액(수수료 포함) */
export function buyCost(price: number, qty: number): number {
  const amount = price * qty;
  return amount + feeFor(amount);
}

/** 현금 cash로 살 수 있는 최대 수량 */
export function maxBuyQty(cash: number, price: number): number {
  if (price <= 0) return 0;
  let q = Math.floor(cash / (price * (1 + ECONOMY.feeRate)));
  while (q > 0 && buyCost(price, q) > cash) q--;
  while (q < ECONOMY.maxOrderQty && buyCost(price, q + 1) <= cash) q++;
  return Math.min(q, ECONOMY.maxOrderQty);
}

// ── 보유 수량 시간 가중 (배당용) ────────────────────────

export function emptyHolding(stockId: string, now: number): Holding {
  return { stockId, shares: 0, reserved: 0, avgPrice: 0, accShareMs: 0, lastAt: now };
}

/** now까지의 보유 시간을 accShareMs에 반영 */
export function accrue(h: Holding, now: number): Holding {
  if (now <= h.lastAt) return h;
  return { ...h, accShareMs: h.accShareMs + h.shares * (now - h.lastAt), lastAt: now };
}

/**
 * 00시 정산. midnight 직전 24시간 동안의 평균 보유 수량 × midnight 가격 × 배당률.
 * 23:59에 사서 00:01에 팔면 1분/24시간만 인정돼요.
 */
export function settleDividend(h: Holding, midnight: number, price: number): { holding: Holding; dividend: number } {
  const periodStart = midnight - DAY;
  const base = h.lastAt < periodStart ? { ...h, accShareMs: 0, lastAt: periodStart } : h;
  const acc = accrue(base, midnight);
  const avgShares = acc.accShareMs / DAY;
  const dividend = Math.floor(avgShares * price * ECONOMY.dividendRate);
  return { holding: { ...acc, accShareMs: 0, lastAt: midnight }, dividend };
}

// ── 체결 ─────────────────────────────────────────────

function assertQty(qty: number) {
  if (!Number.isInteger(qty) || qty <= 0) throw new GameError('invalid-qty', '수량을 1주 이상 입력해 주세요.');
  if (qty > ECONOMY.maxOrderQty) throw new GameError('invalid-qty', `한 번에 ${ECONOMY.maxOrderQty.toLocaleString()}주까지 주문할 수 있어요.`);
}

export interface Fill {
  user: UserDoc;
  holding: Holding;
  price: number;
  qty: number;
  amount: number;
  fee: number;
  /** 현금 변화량 */
  cashDelta: number;
  /** 매도 실현손익 (수수료 반영) */
  profit?: number;
}

/**
 * 매수 체결. fromReserved가 있으면 그 금액(지정가 주문에 묶어 둔 현금)에서 먼저 쓰고 남은 건 돌려줘요.
 */
export function execBuy(user: UserDoc, holding: Holding, price: number, qty: number, now: number, fromReserved = 0): Fill {
  assertQty(qty);
  const amount = price * qty;
  const fee = feeFor(amount);
  const cost = amount + fee;
  let cash = user.cash;
  let reservedCash = user.reservedCash;
  if (fromReserved > 0) {
    reservedCash -= fromReserved;
    cash += fromReserved;
  }
  if (cost > cash) throw new GameError('insufficient-cash', '주문 가능 금액이 부족해요.');
  cash -= cost;
  const h = accrue(holding, now);
  const shares = h.shares + qty;
  const avgPrice = Math.round((h.avgPrice * h.shares + amount) / shares);
  return {
    user: { ...user, cash, reservedCash: Math.max(0, reservedCash) },
    holding: { ...h, shares, avgPrice },
    price,
    qty,
    amount,
    fee,
    cashDelta: -cost,
  };
}

/** 매도 체결. fromReserved=true면 지정가 매도로 묶어 둔 수량에서 빼요. */
export function execSell(user: UserDoc, holding: Holding, price: number, qty: number, now: number, fromReserved = false): Fill {
  assertQty(qty);
  const available = fromReserved ? holding.reserved : holding.shares - holding.reserved;
  if (qty > available) throw new GameError('insufficient-shares', '매도 가능 수량이 부족해요.');
  const amount = price * qty;
  const fee = feeFor(amount);
  const h = accrue(holding, now);
  const shares = h.shares - qty;
  const profit = amount - fee - h.avgPrice * qty;
  return {
    user: { ...user, cash: user.cash + amount - fee },
    holding: {
      ...h,
      shares,
      reserved: fromReserved ? h.reserved - qty : h.reserved,
      avgPrice: shares === 0 ? 0 : h.avgPrice,
    },
    price,
    qty,
    amount,
    fee,
    cashDelta: amount - fee,
    profit,
  };
}

// ── 지정가 주문 ───────────────────────────────────────

export function validateLimitPrice(limitPrice: number) {
  if (!Number.isInteger(limitPrice) || limitPrice <= 0) throw new GameError('invalid-price', '가격을 1날로 이상으로 입력해 주세요.');
}

/** 지정가 주문을 걸 때 묶을 현금/수량을 반영 */
export function reserveForLimit(user: UserDoc, holding: Holding, side: 'buy' | 'sell', qty: number, limitPrice: number) {
  assertQty(qty);
  validateLimitPrice(limitPrice);
  if (side === 'buy') {
    const need = buyCost(limitPrice, qty);
    if (need > user.cash) throw new GameError('insufficient-cash', '주문 가능 금액이 부족해요.');
    return { user: { ...user, cash: user.cash - need, reservedCash: user.reservedCash + need }, holding, reservedCash: need };
  }
  if (qty > holding.shares - holding.reserved) throw new GameError('insufficient-shares', '매도 가능 수량이 부족해요.');
  return { user, holding: { ...holding, reserved: holding.reserved + qty }, reservedCash: 0 };
}

/** 지정가 주문 취소·만료 시 묶은 것 풀기 */
export function releaseLimit(user: UserDoc, holding: Holding, order: Order) {
  if (order.side === 'buy') {
    const r = order.reservedCash ?? 0;
    return { user: { ...user, cash: user.cash + r, reservedCash: Math.max(0, user.reservedCash - r) }, holding };
  }
  return { user, holding: { ...holding, reserved: Math.max(0, holding.reserved - order.qty) } };
}

/** 현재가가 지정가 조건을 만족하는지 */
export function limitTriggered(order: Order, price: number): boolean {
  if (order.status !== 'pending' || order.type !== 'limit' || order.limitPrice == null) return false;
  return order.side === 'buy' ? price <= order.limitPrice : price >= order.limitPrice;
}

export function limitExpiry(now: number): number {
  return kstNextMidnight(now);
}

// ── 자산·랭킹 ─────────────────────────────────────────

export function holdingsValue(holdings: Holding[], priceOf: (stockId: string) => number): number {
  return holdings.reduce((sum, h) => sum + h.shares * priceOf(h.stockId), 0);
}

export function totalAssets(user: UserDoc, holdings: Holding[], priceOf: (stockId: string) => number): number {
  return user.cash + user.reservedCash + holdingsValue(holdings, priceOf);
}

export function weeklyReturn(user: UserDoc, assets: number): number {
  if (user.weekStartAssets <= 0) return 0;
  return (assets - user.weekFlow - user.weekStartAssets) / user.weekStartAssets;
}

/** 새 주가 시작됐으면 주간 기준값을 다시 잡아요 */
export function rollWeek(user: UserDoc, assets: number, now: number): UserDoc {
  const wk = kstWeekKey(now);
  if (user.weekKey === wk) return user;
  return { ...user, weekKey: wk, weekStartAssets: assets, weekFlow: 0 };
}

export function newUser(uid: string, nickname: string, now: number): UserDoc {
  return {
    uid,
    nickname,
    cash: ECONOMY.startCash,
    reservedCash: 0,
    createdAt: now,
    watchlist: ['temp-seoul', 'pm10-seoul', 'rain-busan'],
    totalAssets: ECONOMY.startCash,
    weekKey: kstWeekKey(now),
    weekStartAssets: ECONOMY.startCash,
    weekFlow: 0,
    exchangedToday: 0,
    totalDividends: 0,
    totalExchangedPoints: 0,
  };
}

// ── 구제금 ───────────────────────────────────────────

export function checkBailout(user: UserDoc, assets: number, now: number) {
  if (assets >= ECONOMY.bailoutThreshold) {
    throw new GameError('not-eligible', `총자산이 ${ECONOMY.bailoutThreshold.toLocaleString()}날로보다 적을 때만 받을 수 있어요.`);
  }
  if (user.lastBailoutDay === kstDayKey(now)) throw new GameError('already-claimed', '구제금은 하루에 한 번만 받을 수 있어요.');
}

export function applyBailout(user: UserDoc, now: number): UserDoc {
  return {
    ...user,
    cash: user.cash + ECONOMY.bailoutAmount,
    lastBailoutDay: kstDayKey(now),
    weekFlow: user.weekFlow + ECONOMY.bailoutAmount,
  };
}

// ── 포인트 환전 ───────────────────────────────────────

export function exchangedTodayOf(user: UserDoc, now: number): number {
  return user.exchangeDay === kstDayKey(now) ? user.exchangedToday : 0;
}

export function exchangeRemaining(user: UserDoc, now: number): number {
  return Math.max(0, ECONOMY.dailyPointLimit - exchangedTodayOf(user, now));
}

export function reserveExchange(user: UserDoc, points: number, now: number): { user: UserDoc; coins: number } {
  if (!Number.isInteger(points) || points < ECONOMY.minExchangePoints) {
    throw new GameError('invalid-points', `${ECONOMY.minExchangePoints}포인트 이상 입력해 주세요.`);
  }
  const remaining = exchangeRemaining(user, now);
  if (points > remaining) throw new GameError('daily-limit', `오늘은 ${remaining}포인트까지 바꿀 수 있어요.`);
  const coins = points * ECONOMY.coinsPerPoint;
  if (coins > user.cash) throw new GameError('insufficient-cash', '바꿀 날로가 부족해요.');
  const day = kstDayKey(now);
  return {
    coins,
    user: {
      ...user,
      cash: user.cash - coins,
      exchangeDay: day,
      exchangedToday: exchangedTodayOf(user, now) + points,
      weekFlow: user.weekFlow - coins,
      totalExchangedPoints: user.totalExchangedPoints + points,
    },
  };
}

/** 지급 실패 시 되돌리기 (같은 날일 때만 한도도 복구) */
export function refundExchange(user: UserDoc, points: number, coins: number, dayKey: string): UserDoc {
  const sameDay = user.exchangeDay === dayKey;
  return {
    ...user,
    cash: user.cash + coins,
    exchangedToday: sameDay ? Math.max(0, user.exchangedToday - points) : user.exchangedToday,
    weekFlow: user.weekFlow + coins,
    totalExchangedPoints: Math.max(0, user.totalExchangedPoints - points),
  };
}

// ── 닉네임 ───────────────────────────────────────────

const ADJ = ['맑은', '흐린', '포근한', '선선한', '촉촉한', '쨍한', '바람부는', '눈오는', '안개낀', '따뜻한', '시원한', '무지개'];
const NOUN = ['펭귄', '구름', '수달', '해바라기', '고래', '참새', '여우', '거북이', '다람쥐', '돌고래', '부엉이', '토끼'];

export function randomNickname(rand: () => number = Math.random): string {
  const a = ADJ[Math.floor(rand() * ADJ.length)];
  const n = NOUN[Math.floor(rand() * NOUN.length)];
  const num = String(Math.floor(rand() * 10000)).padStart(4, '0');
  return `${a}${n}${num}`;
}

export function validateNickname(raw: string): string {
  const name = raw.trim().replace(/\s+/g, ' ');
  const len = [...name].length;
  if (len < ECONOMY.nicknameMin || len > ECONOMY.nicknameMax) {
    throw new GameError('invalid-nickname', `닉네임은 ${ECONOMY.nicknameMin}~${ECONOMY.nicknameMax}자로 입력해 주세요.`);
  }
  if (!/^[0-9A-Za-z가-힣 _]+$/.test(name)) throw new GameError('invalid-nickname', '한글, 영문, 숫자만 쓸 수 있어요.');
  if (BANNED.some((w) => name.toLowerCase().includes(w))) throw new GameError('invalid-nickname', '쓸 수 없는 단어가 들어 있어요.');
  return name;
}

/** 최소한의 금칙어. 출시 전에 운영 정책에 맞게 보강하세요. */
const BANNED = ['운영자', '관리자', '토스', 'admin', '시발', '씨발', '병신', '개새', '좆', '섹스'];
