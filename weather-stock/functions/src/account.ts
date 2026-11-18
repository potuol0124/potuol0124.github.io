/** 계정 생성, 닉네임, 관심 종목, 구제금, 포인트 환전 */
import { ECONOMY } from '../../shared/config';
import {
  GameError,
  applyBailout,
  checkBailout,
  newUser,
  priceAt,
  randomNickname,
  refundExchange,
  reserveExchange,
  totalAssets,
  validateNickname,
} from '../../shared/engine';
import { isStockId } from '../../shared/stocks';
import { kstDayKey } from '../../shared/time';
import type { ExchangeDoc, Holding } from '../../shared/types';
import { db, updateChanged, getMarket, getUser, refs } from './db';

export async function ensureUser(uid: string) {
  await db.runTransaction(async (tx) => {
    const ref = refs.user(uid);
    if ((await tx.get(ref)).exists) return;
    const now = Date.now();
    tx.set(ref, newUser(uid, randomNickname(), now));
    const lRef = refs.ledger(uid).doc();
    tx.set(lRef, { id: lRef.id, type: 'signup', amount: ECONOMY.startCash, at: now, memo: '가입 축하 시작 자금' });
  });
}

export async function setNickname(uid: string, raw: unknown) {
  const nickname = validateNickname(String(raw ?? ''));
  await refs.user(uid).update({ nickname });
}

export async function toggleWatch(uid: string, stockId: unknown) {
  if (!isStockId(stockId)) throw new GameError('invalid-stock', '없는 종목이에요.');
  await db.runTransaction(async (tx) => {
    const user = await getUser(tx, uid);
    const has = user.watchlist.includes(stockId);
    if (!has && user.watchlist.length >= ECONOMY.maxWatchlist) {
      throw new GameError('watch-limit', `관심 종목은 ${ECONOMY.maxWatchlist}개까지예요.`);
    }
    tx.update(refs.user(uid), { watchlist: has ? user.watchlist.filter((x) => x !== stockId) : [stockId, ...user.watchlist] });
  });
}

/**
 * 구제금. 광고 시청 여부는 클라이언트 이벤트라 서버에서 검증할 수 없어서,
 * 자산 조건 + 하루 1회 제한으로 남용을 막아요.
 */
export async function claimBailout(uid: string) {
  await db.runTransaction(async (tx) => {
    const now = Date.now();
    const market = await getMarket(tx);
    const user = await getUser(tx, uid);
    const holdings = (await tx.get(db.collection(`users/${uid}/holdings`))).docs.map((d) => d.data() as Holding);
    const assets = totalAssets(user, holdings, (id) => (market.stocks[id] ? priceAt(market.stocks[id], now) : 0));
    checkBailout(user, assets, now);
    const next = applyBailout(user, now);
    updateChanged(tx, refs.user(uid), user, next);
    const lRef = refs.ledger(uid).doc();
    tx.set(lRef, { id: lRef.id, type: 'bailout', amount: ECONOMY.bailoutAmount, at: now, memo: '구제금' });
  });
}

// ── 포인트 환전 ───────────────────────────────────────
// 1) requestExchange: 날로 차감 + 한도 반영 + 예약 문서 생성
// 2) 클라이언트가 Promotion.grantReward로 토스포인트 지급
// 3) confirmExchange(성공) 또는 cancelExchange(실패 → 환불)

export async function requestExchange(uid: string, points: unknown) {
  const p = Number(points);
  return db.runTransaction(async (tx) => {
    const now = Date.now();
    const user = await getUser(tx, uid);
    // 아직 끝나지 않은 환전이 있으면 새로 못 해요 (중복 지급 방지)
    const open = await tx.get(db.collection('exchanges').where('uid', '==', uid).where('status', '==', 'reserved').limit(1));
    if (!open.empty) throw new GameError('exchange-pending', '처리 중인 포인트 지급이 있어요. 잠시 후 다시 시도해 주세요.');
    const r = reserveExchange(user, p, now);
    const exRef = db.collection('exchanges').doc();
    const ex: ExchangeDoc = { id: exRef.id, uid, points: p, coins: r.coins, status: 'reserved', createdAt: now, dayKey: kstDayKey(now) };
    tx.set(exRef, ex);
    updateChanged(tx, refs.user(uid), user, r.user);
    const lRef = refs.ledger(uid).doc();
    tx.set(lRef, { id: lRef.id, type: 'exchange', amount: -r.coins, at: now, memo: `토스포인트 ${p}P로 바꾸기`, points: p });
    return { exchangeId: exRef.id };
  });
}

export async function confirmExchange(uid: string, exchangeId: unknown, rewardKey: unknown) {
  if (typeof exchangeId !== 'string' || typeof rewardKey !== 'string' || !rewardKey) throw new GameError('invalid', '잘못된 요청이에요.');
  await db.runTransaction(async (tx) => {
    const ref = refs.exchange(exchangeId);
    const ex = (await tx.get(ref)).data() as ExchangeDoc | undefined;
    if (!ex || ex.uid !== uid) throw new GameError('not-found', '환전 내역을 찾을 수 없어요.');
    if (ex.status !== 'reserved') return;
    tx.update(ref, { status: 'granted', rewardKey });
  });
}

export async function cancelExchange(uid: string, exchangeId: unknown, reason: unknown) {
  if (typeof exchangeId !== 'string') throw new GameError('invalid', '잘못된 요청이에요.');
  await db.runTransaction(async (tx) => {
    const ref = refs.exchange(exchangeId);
    const ex = (await tx.get(ref)).data() as ExchangeDoc | undefined;
    if (!ex || ex.uid !== uid) throw new GameError('not-found', '환전 내역을 찾을 수 없어요.');
    if (ex.status !== 'reserved') return;
    const user = await getUser(tx, uid);
    const next = refundExchange(user, ex.points, ex.coins, ex.dayKey);
    updateChanged(tx, refs.user(uid), user, next);
    tx.update(ref, { status: 'cancelled', error: String(reason ?? '').slice(0, 300) });
    const lRef = refs.ledger(uid).doc();
    tx.set(lRef, { id: lRef.id, type: 'refund', amount: ex.coins, at: Date.now(), memo: '포인트 지급 실패로 돌려받음' });
  });
}
