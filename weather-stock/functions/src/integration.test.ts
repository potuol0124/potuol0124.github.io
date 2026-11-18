/**
 * Firestore 에뮬레이터 통합 테스트.
 * 실행: firebase emulators:exec --only firestore --project demo-weather-stock "npm test"
 * (FIRESTORE_EMULATOR_HOST가 없으면 건너뛰어요)
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { ECONOMY } from '../../shared/config';
import { nextStockState } from '../../shared/market';
import { METRIC_BY_ID, valueToPrice } from '../../shared/metrics';
import { STOCKS } from '../../shared/stocks';
import { HOUR, kstNextMidnight, parseKst } from '../../shared/time';
import type { ExchangeDoc, Holding, MarketState, Order, Ranking, UserDoc } from '../../shared/types';

const enabled = !!process.env.FIRESTORE_EMULATOR_HOST;
const T = parseKst('20261118', '1200');
const UID = 'test-user';

describe.skipIf(!enabled)('서버 통합 (Firestore 에뮬레이터)', async () => {
  process.env.GCLOUD_PROJECT ??= 'demo-weather-stock';
  const { db, refs } = await import('./db');
  const account = await import('./account');
  const trading = await import('./trading');
  const { dailySettlement } = await import('./settle');
  const { updateRankings } = await import('./ranking');

  const market = (now: number, override: Record<string, number> = {}): MarketState => {
    const stocks: MarketState['stocks'] = {};
    for (const s of STOCKS) {
      const m = METRIC_BY_ID[s.metricId];
      stocks[s.id] = nextStockState(undefined, m, { value: m.baseValue, obsAt: now, forecast: [], now });
      if (override[s.id]) Object.assign(stocks[s.id], { anchorPrice: override[s.id], targetPrice: override[s.id] });
    }
    return { updatedAt: now, obsHour: now, stocks, dust: {} };
  };
  const user = async () => (await refs.user(UID).get()).data() as UserDoc;
  const holding = async (id: string) => (await refs.holding(UID, id).get()).data() as Holding | undefined;

  beforeAll(async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(T);
    await db.recursiveDelete(db.collection('users'));
    await db.recursiveDelete(db.collection('exchanges'));
    await refs.market().set(market(T));
  });
  afterAll(() => vi.useRealTimers());

  it('가입하면 시작 자금', async () => {
    await account.ensureUser(UID);
    await account.ensureUser(UID); // 두 번 불러도 한 번만
    expect((await user()).cash).toBe(ECONOMY.startCash);
  });

  it('시장가 매수', async () => {
    const o = await trading.placeOrder(UID, { stockId: 'temp-seoul', side: 'buy', type: 'market', qty: 10 });
    expect(o.status).toBe('filled');
    expect(o.price).toBe(20_000);
    expect((await user()).cash).toBe(ECONOMY.startCash - 200_000 - 400);
    expect((await holding('temp-seoul'))?.shares).toBe(10);
  });

  it('지정가 매수 → 가격이 내려오면 1분 체결 작업이 체결, 남은 예약금 반환', async () => {
    const before = await user();
    const o = await trading.placeOrder(UID, { stockId: 'pm10-seoul', side: 'buy', type: 'limit', qty: 5, limitPrice: 7_000 });
    expect(o.status).toBe('pending');
    const reserved = (await user()).reservedCash;
    expect(reserved).toBe(35_000 + 70);
    await refs.market().set(market(T, { 'pm10-seoul': 6_900 }));
    const r = await trading.matchLimitOrders();
    expect(r.filled).toBe(1);
    const after = await user();
    expect(after.reservedCash).toBe(0);
    expect(after.cash).toBe(before.cash - 34_500 - 69);
    const filled = (await refs.orders(UID).doc(o.id).get()).data() as Order;
    expect(filled.status).toBe('filled');
    expect(filled.price).toBe(6_900);
  });

  it('지정가 매도 걸고 취소하면 수량 원상복구', async () => {
    const o = await trading.placeOrder(UID, { stockId: 'temp-seoul', side: 'sell', type: 'limit', qty: 5, limitPrice: 25_000 });
    expect((await holding('temp-seoul'))?.reserved).toBe(5);
    await expect(trading.placeOrder(UID, { stockId: 'temp-seoul', side: 'sell', type: 'market', qty: 6 })).rejects.toThrow(/부족/);
    await trading.cancelOrder(UID, o.id);
    expect((await holding('temp-seoul'))?.reserved).toBe(0);
  });

  it('포인트 환전: 예약 → 확정, 진행 중엔 중복 불가, 하루 한도', async () => {
    const cash0 = (await user()).cash;
    const { exchangeId } = await account.requestExchange(UID, 10);
    await expect(account.requestExchange(UID, 1)).rejects.toThrow(/처리 중/);
    await account.confirmExchange(UID, exchangeId, 'reward-key-1');
    expect(((await refs.exchange(exchangeId).get()).data() as ExchangeDoc).status).toBe('granted');
    expect((await user()).cash).toBe(cash0 - 10_000);
    await expect(account.requestExchange(UID, ECONOMY.dailyPointLimit - 9)).rejects.toThrow(/오늘은/);
    // 실패하면 환불
    const { exchangeId: id2 } = await account.requestExchange(UID, 5);
    await account.cancelExchange(UID, id2, '테스트 실패');
    expect((await user()).cash).toBe(cash0 - 10_000);
    expect((await user()).exchangedToday).toBe(10);
  });

  it('구제금은 자산이 많으면 거절', async () => {
    await expect(account.claimBailout(UID)).rejects.toThrow(/적을 때만/);
  });

  it('00시 정산: 보유 시간만큼 배당, 두 번 실행해도 한 번만', async () => {
    const midnight = kstNextMidnight(T);
    vi.setSystemTime(midnight + 30_000);
    await refs.market().set(market(midnight - 10 * 60_000));
    const cash0 = (await user()).cash;
    await dailySettlement(midnight + 30_000);
    await dailySettlement(midnight + 60_000);
    const u = await user();
    // temp-seoul 10주 × 12시간, pm10-seoul 5주 × 12시간 (테스트 시계가 멈춰 있어 체결 시각이 모두 12:00)
    const expected = Math.floor(5 * 20_000 * ECONOMY.dividendRate) + Math.floor(2.5 * valueToPrice(METRIC_BY_ID.pm10, 40) * ECONOMY.dividendRate);
    expect(u.cash - cash0).toBe(expected);
    expect(u.lastDividend?.amount).toBe(expected);
    expect((await holding('temp-seoul'))?.accShareMs).toBe(0);
  });

  it('랭킹 집계', async () => {
    await updateRankings(market(T + HOUR), T + HOUR);
    const r = (await refs.ranking().get()).data() as Ranking;
    expect(r.total[0].uid).toBe(UID);
    expect((await user()).totalAssets).toBe(r.total[0].totalAssets);
  });
});
