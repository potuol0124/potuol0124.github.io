/**
 * 매시간 모든 계정의 총자산을 평가해서 users.totalAssets를 갱신하고 랭킹 상위 100명을 저장해요.
 * 사용자가 아주 많아지면(수만 명 이상) 이 부분은 Cloud Tasks로 나눠 처리하는 걸 권장해요.
 */
import { priceAt, weeklyReturn } from '../../shared/engine';
import { kstWeekKey } from '../../shared/time';
import type { Holding, MarketState, Ranking, RankingEntry, UserDoc } from '../../shared/types';
import { db, refs } from './db';

export async function updateRankings(market: MarketState, now = Date.now()) {
  const priceOf = (id: string) => {
    const s = market.stocks[id];
    return s ? priceAt(s, now) : 0;
  };

  // 보유 주식 평가액 (uid별)
  const stockValue = new Map<string, number>();
  const holdings = await db.collectionGroup('holdings').where('shares', '>', 0).get();
  for (const d of holdings.docs) {
    const uid = d.ref.parent.parent!.id;
    const h = d.data() as Holding;
    stockValue.set(uid, (stockValue.get(uid) ?? 0) + h.shares * priceOf(h.stockId));
  }

  const entries: RankingEntry[] = [];
  const writer = db.bulkWriter();
  const users = await db.collection('users').select('nickname', 'cash', 'reservedCash', 'totalAssets', 'weekKey', 'weekStartAssets', 'weekFlow').get();
  const wk = kstWeekKey(now);
  for (const d of users.docs) {
    const u = d.data() as UserDoc;
    const assets = (u.cash ?? 0) + (u.reservedCash ?? 0) + (stockValue.get(d.id) ?? 0);
    if (assets !== u.totalAssets) writer.update(d.ref, { totalAssets: assets });
    entries.push({
      uid: d.id,
      nickname: u.nickname,
      totalAssets: assets,
      // 이번 주 기준값이 아직 안 잡힌 계정(00시 정산 전)은 0%로 봐요
      weeklyReturn: u.weekKey === wk ? weeklyReturn(u, assets) : 0,
    });
  }
  await writer.close();

  const ranking: Ranking = {
    updatedAt: now,
    weekKey: wk,
    weekly: [...entries].sort((a, b) => b.weeklyReturn - a.weeklyReturn).slice(0, 100),
    total: [...entries].sort((a, b) => b.totalAssets - a.totalAssets).slice(0, 100),
  };
  await refs.ranking().set(ranking);
}
