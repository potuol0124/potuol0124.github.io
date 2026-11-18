/**
 * 매일 00시(KST) 정산
 *  1) 당일 지정가 주문 만료 → 묶인 현금·수량 해제
 *  2) 지난 24시간 평균 보유 평가액 × 배당률 지급
 *  3) 월요일이면 주간 랭킹 기준값 갱신
 *  4) 오래된 환전 예약은 수동 확인 대상으로 표시
 * 같은 날 두 번 실행돼도 users.lastSettledDay로 중복 지급을 막아요.
 */
import { DAY, HOUR, kstDayKey, kstDayStart } from '../../shared/time';
import { priceAt, releaseLimit, rollWeek, settleDividend, emptyHolding } from '../../shared/engine';
import type { ExchangeDoc, Holding, MarketState, Order, UserDoc } from '../../shared/types';
import { db, updateChanged, getMarket, pool, refs } from './db';

type SettledUser = UserDoc & { lastSettledDay?: string };

async function settleUser(uid: string, midnight: number, market: MarketState) {
  const dayKey = kstDayKey(midnight - 1); // 정산 대상 날짜(어제)
  const priceOf = (id: string) => {
    const s = market.stocks[id];
    return s ? priceAt(s, midnight) : 0;
  };
  await db.runTransaction(async (tx) => {
    const userRef = refs.user(uid);
    const user = (await tx.get(userRef)).data() as SettledUser | undefined;
    if (!user || user.lastSettledDay === dayKey) return;
    const hSnaps = await tx.get(db.collection(`users/${uid}/holdings`));
    const oSnaps = await tx.get(refs.orders(uid).where('status', '==', 'pending').where('expiresAt', '<=', midnight));

    let next: SettledUser = { ...user };
    const holdings = new Map<string, Holding>(hSnaps.docs.map((d) => [d.id, d.data() as Holding]));

    for (const d of oSnaps.docs) {
      const o = d.data() as Order;
      const h = holdings.get(o.stockId) ?? emptyHolding(o.stockId, midnight);
      const r = releaseLimit(next, h, o);
      next = r.user as SettledUser;
      if (holdings.has(o.stockId)) holdings.set(o.stockId, r.holding);
      tx.update(d.ref, { status: 'expired' });
    }

    let total = 0;
    let assets = next.cash + next.reservedCash;
    for (const [id, h] of holdings) {
      const { holding, dividend } = settleDividend(h, midnight, priceOf(id));
      total += dividend;
      assets += holding.shares * priceOf(id);
      const ref = refs.holding(uid, id);
      if (holding.shares === 0 && holding.reserved === 0) tx.delete(ref);
      else tx.set(ref, holding);
    }
    if (total > 0) {
      next = { ...next, cash: next.cash + total, totalDividends: next.totalDividends + total, lastDividend: { day: dayKey, amount: total } };
      assets += total;
      const lRef = refs.ledger(uid).doc();
      tx.set(lRef, { id: lRef.id, type: 'dividend', amount: total, at: midnight, memo: '00시 보유 배당' });
    }
    next = rollWeek(next, assets, midnight) as SettledUser;
    next.lastSettledDay = dayKey;
    next.totalAssets = assets;
    updateChanged(tx, userRef, user, next);
  });
}

export async function dailySettlement(now = Date.now()) {
  const midnight = kstDayStart(now);
  const market = await getMarket();
  const users = await db.collection('users').select().get();
  let failed = 0;
  await pool(users.docs, 20, async (d) => {
    try {
      await settleUser(d.id, midnight, market);
    } catch (e) {
      failed++;
      console.error('정산 실패', d.id, e);
    }
  });

  // 1시간 넘게 'reserved'로 남은 환전은 지급 여부를 알 수 없어서 수동 확인으로 돌려요
  const stale = await db.collection('exchanges').where('status', '==', 'reserved').where('createdAt', '<', now - HOUR).get();
  const writer = db.bulkWriter();
  stale.docs.forEach((d) => writer.update(d.ref, { status: 'needs_review' } satisfies Partial<ExchangeDoc>));
  await writer.close();

  console.log(`00시 정산 완료: ${users.size}명, 실패 ${failed}명, 환전 확인 필요 ${stale.size}건`);
  return { users: users.size, failed, staleExchanges: stale.size, midnight, nextMidnight: midnight + DAY };
}
