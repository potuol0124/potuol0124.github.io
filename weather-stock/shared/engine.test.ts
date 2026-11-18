import { describe, expect, it } from 'vitest';
import { ECONOMY } from './config';
import {
  GameError,
  applyBailout,
  buyCost,
  checkBailout,
  emptyHolding,
  execBuy,
  execSell,
  exchangeRemaining,
  limitTriggered,
  maxBuyQty,
  newUser,
  priceAt,
  refundExchange,
  releaseLimit,
  reserveExchange,
  reserveForLimit,
  rollWeek,
  settleDividend,
  validateNickname,
  weeklyReturn,
} from './engine';
import { nextStockState } from './market';
import { METRIC_BY_ID, valueToPrice } from './metrics';
import { STOCKS } from './stocks';
import { DAY, HOUR, kstDayKey, kstDayStart, kstWeekKey, parseKst } from './time';
import type { Order } from './types';

const T0 = parseKst('20261118', '1200'); // 2026-11-18(수) 12:00 KST

describe('시간', () => {
  it('KST 날짜 경계', () => {
    expect(kstDayKey(parseKst('20261118', '0000'))).toBe('20261118');
    expect(kstDayKey(parseKst('20261118', '0000') - 1)).toBe('20261117');
    expect(kstDayStart(T0)).toBe(parseKst('20261118', '0000'));
  });
  it('주는 월요일 00시에 시작', () => {
    expect(kstWeekKey(T0)).toBe('20261116');
    expect(kstWeekKey(parseKst('20261122', '2359'))).toBe('20261116'); // 일요일
    expect(kstWeekKey(parseKst('20261123', '0000'))).toBe('20261123'); // 월요일
  });
});

describe('종목·가격', () => {
  it('17개 지역 × 6개 지표 = 102종목, 코드 중복 없음', () => {
    expect(STOCKS).toHaveLength(102);
    expect(new Set(STOCKS.map((s) => s.code)).size).toBe(102);
  });
  it('기준 수치에서 기준가, 영하·0mm에서도 양수', () => {
    for (const m of Object.values(METRIC_BY_ID)) {
      expect(valueToPrice(m, m.baseValue)).toBe(m.basePrice);
      expect(valueToPrice(m, m.min)).toBeGreaterThan(0);
    }
    expect(valueToPrice(METRIC_BY_ID.temp, -20)).toBeGreaterThan(0);
    expect(valueToPrice(METRIC_BY_ID.rain, 10)).toBeGreaterThan(valueToPrice(METRIC_BY_ID.rain, 1));
  });
  it('priceAt은 anchor→target 직선 보간', () => {
    const s = { anchorPrice: 1000, anchorAt: 0, targetPrice: 2000, targetAt: 100 };
    expect(priceAt(s, -5)).toBe(1000);
    expect(priceAt(s, 50)).toBe(1500);
    expect(priceAt(s, 500)).toBe(2000);
  });
  it('nextStockState: 날이 바뀌면 00시 가격으로 dayOpen을 다시 잡아요', () => {
    const m = METRIC_BY_ID.temp;
    const d1 = parseKst('20261117', '2350');
    const prev = nextStockState(undefined, m, { value: 10, obsAt: d1 - 50 * 60_000, forecast: [{ t: d1 + 10 * 60_000, v: 12 }], now: d1 });
    const d2 = parseKst('20261118', '0050');
    const next = nextStockState(prev, m, { value: 11, obsAt: d2 - 50 * 60_000, forecast: [], now: d2 });
    expect(next.dayOpen).toBe(priceAt(prev, parseKst('20261118', '0000')));
    expect(next.targetPrice).toBe(next.anchorPrice); // 예보 없으면 그대로
  });
});

describe('매매', () => {
  const user = newUser('u', '테스트', T0);
  it('매수: 수수료 포함 차감, 평균단가', () => {
    const f = execBuy(user, emptyHolding('temp-seoul', T0), 10_000, 10, T0);
    expect(f.fee).toBe(Math.ceil(100_000 * ECONOMY.feeRate));
    expect(f.user.cash).toBe(ECONOMY.startCash - 100_000 - f.fee);
    expect(f.holding.shares).toBe(10);
    expect(f.holding.avgPrice).toBe(10_000);
    const f2 = execBuy(f.user, f.holding, 20_000, 10, T0 + 1000);
    expect(f2.holding.avgPrice).toBe(15_000);
  });
  it('현금이 모자라면 거절', () => {
    expect(() => execBuy(user, emptyHolding('temp-seoul', T0), 10_000, 1000, T0)).toThrow(GameError);
  });
  it('maxBuyQty로 산 수량은 항상 살 수 있어요', () => {
    for (const p of [1, 7, 999, 12_345, 33_333]) {
      const q = maxBuyQty(user.cash, p);
      expect(buyCost(p, q)).toBeLessThanOrEqual(user.cash);
      if (q < ECONOMY.maxOrderQty) expect(buyCost(p, q + 1)).toBeGreaterThan(user.cash);
    }
  });
  it('매도: 실현손익, 다 팔면 평균단가 0', () => {
    const b = execBuy(user, emptyHolding('temp-seoul', T0), 10_000, 10, T0);
    const s = execSell(b.user, b.holding, 12_000, 10, T0 + HOUR);
    expect(s.holding.shares).toBe(0);
    expect(s.holding.avgPrice).toBe(0);
    expect(s.profit).toBe(120_000 - s.fee - 100_000);
    expect(() => execSell(b.user, b.holding, 12_000, 11, T0)).toThrow(GameError);
  });
  it('지정가: 묶고 풀면 원래대로', () => {
    const h = emptyHolding('temp-seoul', T0);
    const r = reserveForLimit(user, h, 'buy', 10, 9_000);
    expect(r.user.cash + r.user.reservedCash).toBe(user.cash);
    const order = { side: 'buy', qty: 10, reservedCash: r.reservedCash } as Order;
    const back = releaseLimit(r.user, r.holding, order);
    expect(back.user.cash).toBe(user.cash);
    expect(back.user.reservedCash).toBe(0);
  });
  it('지정가 매수가 더 싸게 체결되면 남은 예약금은 돌려받아요', () => {
    const r = reserveForLimit(user, emptyHolding('temp-seoul', T0), 'buy', 10, 9_000);
    const f = execBuy(r.user, r.holding, 8_000, 10, T0, r.reservedCash);
    expect(f.user.reservedCash).toBe(0);
    expect(f.user.cash).toBe(user.cash - 80_000 - f.fee);
  });
  it('지정가 조건', () => {
    const o = { status: 'pending', type: 'limit', side: 'buy', limitPrice: 100 } as Order;
    expect(limitTriggered(o, 100)).toBe(true);
    expect(limitTriggered(o, 101)).toBe(false);
    expect(limitTriggered({ ...o, side: 'sell' }, 101)).toBe(true);
  });
});

describe('배당', () => {
  const midnight = parseKst('20261119', '0000');
  it('24시간 내내 들고 있으면 평가액 × 배당률', () => {
    const h = { ...emptyHolding('temp-seoul', midnight - DAY), shares: 100 };
    const { dividend, holding } = settleDividend(h, midnight, 10_000);
    expect(dividend).toBe(Math.floor(100 * 10_000 * ECONOMY.dividendRate));
    expect(holding.accShareMs).toBe(0);
    expect(holding.lastAt).toBe(midnight);
  });
  it('23시에 사면 1/24만 인정', () => {
    const u = newUser('u', '테스트', midnight - DAY);
    const f = execBuy(u, emptyHolding('temp-seoul', midnight - DAY), 10_000, 24, midnight - HOUR);
    const { dividend } = settleDividend(f.holding, midnight, 10_000);
    expect(dividend).toBe(Math.floor(1 * 10_000 * ECONOMY.dividendRate));
  });
  it('배당 직전에 사고 직후 팔아도 거의 못 받아요', () => {
    const u = newUser('u', '테스트', midnight - DAY);
    const b = execBuy(u, emptyHolding('temp-seoul', midnight - DAY), 10_000, 90, midnight - 60_000);
    const { dividend } = settleDividend(b.holding, midnight, 10_000);
    expect(dividend).toBeLessThan(5);
  });
  it('며칠 동안 정산이 없었던 보유분도 하루치만 계산', () => {
    const h = { ...emptyHolding('temp-seoul', midnight - 5 * DAY), shares: 10 };
    expect(settleDividend(h, midnight, 1_000).dividend).toBe(Math.floor(10 * 1_000 * ECONOMY.dividendRate));
  });
});

describe('환전·구제금·랭킹', () => {
  it('하루 한도와 환불', () => {
    const u = newUser('u', '테스트', T0);
    const r = reserveExchange(u, ECONOMY.dailyPointLimit, T0);
    expect(r.coins).toBe(ECONOMY.dailyPointLimit * ECONOMY.coinsPerPoint);
    expect(exchangeRemaining(r.user, T0)).toBe(0);
    expect(() => reserveExchange(r.user, 1, T0)).toThrow(/오늘은/);
    expect(exchangeRemaining(r.user, T0 + DAY)).toBe(ECONOMY.dailyPointLimit); // 다음 날 초기화
    const back = refundExchange(r.user, ECONOMY.dailyPointLimit, r.coins, kstDayKey(T0));
    expect(back.cash).toBe(u.cash);
    expect(exchangeRemaining(back, T0)).toBe(ECONOMY.dailyPointLimit);
  });
  it('구제금은 자산 조건 + 하루 1회', () => {
    const u = { ...newUser('u', '테스트', T0), cash: 100 };
    expect(() => checkBailout(u, 1_000_000, T0)).toThrow(GameError);
    checkBailout(u, 100, T0);
    const after = applyBailout(u, T0);
    expect(() => checkBailout(after, 100, T0)).toThrow(/하루에 한 번/);
  });
  it('주간 수익률은 구제금·환전을 빼고 계산', () => {
    const u = newUser('u', '테스트', T0);
    const withBailout = applyBailout(u, T0);
    expect(weeklyReturn(withBailout, ECONOMY.startCash + ECONOMY.bailoutAmount)).toBe(0);
    const ex = reserveExchange(u, 10, T0);
    expect(weeklyReturn(ex.user, ECONOMY.startCash - ex.coins)).toBe(0);
    const rolled = rollWeek(u, 2_000_000, T0 + 7 * DAY);
    expect(rolled.weekStartAssets).toBe(2_000_000);
  });
  it('닉네임 검사', () => {
    expect(validateNickname('  맑은 펭귄 ')).toBe('맑은 펭귄');
    expect(() => validateNickname('a')).toThrow();
    expect(() => validateNickname('운영자123')).toThrow();
    expect(() => validateNickname('<script>')).toThrow();
  });
});
