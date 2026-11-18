/**
 * 주문 처리: 시장가·지정가 주문, 취소, 1분마다 지정가 체결 확인.
 * 모든 체결은 Firestore 트랜잭션 안에서 서버 시각 기준 가격으로 계산해요.
 */
import type { Transaction } from 'firebase-admin/firestore';
import { HttpsError } from 'firebase-functions/v2/https';
import { ECONOMY } from '../../shared/config';
import {
  GameError,
  accrue,
  emptyHolding,
  execBuy,
  execSell,
  limitExpiry,
  limitTriggered,
  priceAt,
  releaseLimit,
  reserveForLimit,
  type Fill,
} from '../../shared/engine';
import { STOCK_BY_ID, isStockId } from '../../shared/stocks';
import type { Holding, LedgerEntry, MarketState, Order, OrderSide, OrderType, UserDoc } from '../../shared/types';
import { db, updateChanged, getMarket, getUser, pool, refs } from './db';

export interface OrderInput {
  stockId: string;
  side: OrderSide;
  type: OrderType;
  qty: number;
  limitPrice?: number;
}

function validate(input: OrderInput): OrderInput {
  const { stockId, side, type, qty, limitPrice } = input ?? ({} as OrderInput);
  if (!isStockId(stockId)) throw new GameError('invalid-stock', '없는 종목이에요.');
  if (side !== 'buy' && side !== 'sell') throw new GameError('invalid-side', '주문 종류가 올바르지 않아요.');
  if (type !== 'market' && type !== 'limit') throw new GameError('invalid-type', '주문 방식이 올바르지 않아요.');
  if (!Number.isInteger(qty) || qty <= 0) throw new GameError('invalid-qty', '수량을 1주 이상 입력해 주세요.');
  if (type === 'limit' && (!Number.isInteger(limitPrice) || (limitPrice ?? 0) <= 0)) {
    throw new GameError('invalid-price', '가격을 1날로 이상으로 입력해 주세요.');
  }
  return { stockId, side, type, qty, limitPrice: type === 'limit' ? limitPrice : undefined };
}

function currentPrice(market: MarketState, stockId: string, now: number): number {
  const s = market.stocks[stockId];
  if (!s) throw new HttpsError('unavailable', '이 종목의 시세가 아직 없어요.');
  return priceAt(s, now);
}

function ledgerFor(stockId: string, side: OrderSide, fill: Fill, now: number, id: string): LedgerEntry {
  return {
    id,
    type: side,
    amount: fill.cashDelta,
    at: now,
    memo: `${STOCK_BY_ID[stockId].name} ${fill.qty.toLocaleString('ko-KR')}주 ${side === 'buy' ? '매수' : '매도'}`,
    stockId,
    qty: fill.qty,
    price: fill.price,
    fee: fill.fee,
    profit: fill.profit,
  };
}

function writeHolding(tx: Transaction, uid: string, h: Holding) {
  const ref = refs.holding(uid, h.stockId);
  if (h.shares === 0 && h.reserved === 0 && h.accShareMs === 0) tx.delete(ref);
  else tx.set(ref, h);
}

export async function placeOrder(uid: string, raw: OrderInput): Promise<Order> {
  const input = validate(raw);
  return db.runTransaction(async (tx) => {
    const now = Date.now();
    const market = await getMarket(tx);
    const user = await getUser(tx, uid);
    const hSnap = await tx.get(refs.holding(uid, input.stockId));
    const holding = hSnap.data() ?? emptyHolding(input.stockId, now);
    const price = currentPrice(market, input.stockId, now);

    const orderRef = refs.orders(uid).doc();
    const order: Order = {
      id: orderRef.id,
      stockId: input.stockId,
      side: input.side,
      type: input.type,
      qty: input.qty,
      limitPrice: input.limitPrice,
      status: 'pending',
      createdAt: now,
    };

    const marketable = input.type === 'market' || limitTriggered(order, price);
    let nextUser: UserDoc;
    if (marketable) {
      const fill = input.side === 'buy' ? execBuy(user, holding, price, input.qty, now) : execSell(user, holding, price, input.qty, now);
      nextUser = fill.user;
      writeHolding(tx, uid, fill.holding);
      Object.assign(order, { status: 'filled', filledAt: now, price, fee: fill.fee, amount: fill.amount });
      const lRef = refs.ledger(uid).doc();
      tx.set(lRef, ledgerFor(input.stockId, input.side, fill, now, lRef.id));
    } else {
      const open = await tx.get(refs.orders(uid).where('status', '==', 'pending').count());
      if (open.data().count >= ECONOMY.maxOpenOrders) {
        throw new GameError('too-many-orders', `미체결 주문은 ${ECONOMY.maxOpenOrders}개까지 걸어둘 수 있어요.`);
      }
      const r = reserveForLimit(user, accrue(holding, now), input.side, input.qty, input.limitPrice!);
      nextUser = r.user;
      writeHolding(tx, uid, r.holding);
      order.reservedCash = r.reservedCash || undefined;
      order.expiresAt = limitExpiry(now);
    }
    updateChanged(tx, refs.user(uid), user, nextUser);
    tx.set(orderRef, order);
    return order;
  });
}

export async function cancelOrder(uid: string, orderId: string) {
  if (typeof orderId !== 'string' || !orderId) throw new GameError('not-found', '주문을 찾을 수 없어요.');
  await db.runTransaction(async (tx) => {
    const oRef = refs.orders(uid).doc(orderId);
    const order = (await tx.get(oRef)).data() as Order | undefined;
    if (!order || order.status !== 'pending') throw new GameError('not-found', '취소할 수 있는 주문이 없어요.');
    const user = await getUser(tx, uid);
    const hSnap = await tx.get(refs.holding(uid, order.stockId));
    const holding = hSnap.data() ?? emptyHolding(order.stockId, Date.now());
    const r = releaseLimit(user, holding, order);
    updateChanged(tx, refs.user(uid), user, r.user);
    if (hSnap.exists) writeHolding(tx, uid, r.holding);
    tx.update(oRef, { status: 'cancelled' });
  });
}

/** 걸려 있는 지정가 주문 하나를 (조건이 맞으면) 체결 */
async function tryFill(uid: string, orderId: string) {
  await db.runTransaction(async (tx) => {
    const now = Date.now();
    const oRef = refs.orders(uid).doc(orderId);
    const order = (await tx.get(oRef)).data() as Order | undefined;
    if (!order || order.status !== 'pending') return;
    const market = await getMarket(tx);
    const price = currentPrice(market, order.stockId, now);
    if (!limitTriggered(order, price)) return;
    const user = await getUser(tx, uid);
    const holding = (await tx.get(refs.holding(uid, order.stockId))).data() ?? emptyHolding(order.stockId, now);
    let fill: Fill;
    try {
      fill =
        order.side === 'buy'
          ? execBuy(user, holding, price, order.qty, now, order.reservedCash ?? 0)
          : execSell(user, holding, price, order.qty, now, true);
    } catch (e) {
      // 묶어 둔 자산이 어긋난 경우(이론상 없음): 주문을 취소하고 묶음 해제
      console.error('지정가 체결 실패', uid, orderId, e);
      const r = releaseLimit(user, holding, order);
      updateChanged(tx, refs.user(uid), user, r.user);
      writeHolding(tx, uid, r.holding);
      tx.update(oRef, { status: 'cancelled' });
      return;
    }
    updateChanged(tx, refs.user(uid), user, fill.user);
    writeHolding(tx, uid, fill.holding);
    tx.update(oRef, { status: 'filled', filledAt: now, price, fee: fill.fee, amount: fill.amount });
    const lRef = refs.ledger(uid).doc();
    tx.set(lRef, ledgerFor(order.stockId, order.side, fill, now, lRef.id));
  });
}

/** 1분마다: 조건을 만족한 지정가 주문 체결 */
export async function matchLimitOrders() {
  const now = Date.now();
  const market = await getMarket();
  const pending = await db.collectionGroup('orders').where('status', '==', 'pending').get();
  const due = pending.docs.filter((d) => {
    const o = d.data() as Order;
    const s = market.stocks[o.stockId];
    return s && limitTriggered(o, priceAt(s, now));
  });
  await pool(due, 10, async (d) => {
    try {
      await tryFill(d.ref.parent.parent!.id, d.id);
    } catch (e) {
      console.error('지정가 체결 오류', d.ref.path, e);
    }
  });
  return { checked: pending.size, filled: due.length };
}
