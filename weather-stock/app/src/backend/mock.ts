/**
 * 목업 백엔드: 서버 없이 브라우저만으로 앱 전체를 돌려 봐요.
 * 날씨는 weatherSim의 가짜 값, 계정은 localStorage에 저장해요.
 * 체결·배당·환전 계산은 서버와 같은 shared/engine을 써요.
 */
import { ECONOMY } from '@shared/config';
import {
  GameError,
  accrue,
  applyBailout,
  checkBailout,
  emptyHolding,
  execBuy,
  execSell,
  limitExpiry,
  limitTriggered,
  newUser,
  priceAt,
  randomNickname,
  refundExchange,
  releaseLimit,
  reserveExchange,
  reserveForLimit,
  rollWeek,
  settleDividend,
  totalAssets,
  validateNickname,
  weeklyReturn,
} from '@shared/engine';
import { UPDATE_MINUTE } from '@shared/market';
import { METRIC_BY_ID, valueToPrice } from '@shared/metrics';
import { REGIONS } from '@shared/regions';
import { STOCKS, STOCK_BY_ID, type StockDef, isStockId } from '@shared/stocks';
import { DAY, HOUR, kstDayKey, kstDayStart, kstWeekKey } from '@shared/time';
import type {
  ExchangeDoc,
  Holding,
  LedgerEntry,
  MarketState,
  Order,
  PricePoint,
  Ranking,
  RankingEntry,
  StockState,
  UserDoc,
} from '@shared/types';
import { simForecast, simValue } from './weatherSim';
import type { Account, Backend, OrderRequest } from './types';

const STORAGE_KEY = 'weather-stock:mock:v1';
const UPDATE_OFFSET = UPDATE_MINUTE * 60_000;

// ── 가짜 시장 ─────────────────────────────────────────

/** 시각 t에 반영돼 있는 마지막 관측 정시 (hourIdx) */
function obsHourAt(t: number): number {
  return Math.floor((t - UPDATE_OFFSET) / HOUR);
}

const segCache = new Map<string, { anchorPrice: number; anchorAt: number; targetPrice: number; targetAt: number }>();

function segment(s: StockDef, hourIdx: number) {
  const key = `${s.id}:${hourIdx}`;
  const hit = segCache.get(key);
  if (hit) return hit;
  const m = METRIC_BY_ID[s.metricId];
  const anchorPrice = valueToPrice(m, simValue(s.metricId, s.regionId, hourIdx));
  const hasForecast = s.metricId !== 'pm10' && s.metricId !== 'pm25';
  const targetPrice = hasForecast ? valueToPrice(m, simForecast(s.metricId, s.regionId, hourIdx, hourIdx + 1)) : anchorPrice;
  const anchorAt = hourIdx * HOUR + UPDATE_OFFSET;
  const seg = { anchorPrice, anchorAt, targetPrice, targetAt: anchorAt + HOUR };
  if (segCache.size > 200_000) segCache.clear();
  segCache.set(key, seg);
  return seg;
}

export function mockPriceAt(stockId: string, t: number): number {
  return priceAt(segment(STOCK_BY_ID[stockId], obsHourAt(t)), t);
}

function stockState(s: StockDef, t: number): StockState {
  const H = obsHourAt(t);
  const seg = segment(s, H);
  const dayStart = kstDayStart(t);
  const dayOpen = priceAt(segment(s, obsHourAt(dayStart)), dayStart);
  let high = Math.max(dayOpen, seg.anchorPrice);
  let low = Math.min(dayOpen, seg.anchorPrice);
  for (let h = obsHourAt(dayStart) + 1; h < H; h++) {
    const p = segment(s, h).anchorPrice;
    high = Math.max(high, p);
    low = Math.min(low, p);
  }
  const hasForecast = s.metricId !== 'pm10' && s.metricId !== 'pm25';
  return {
    value: simValue(s.metricId, s.regionId, H),
    obsAt: H * HOUR,
    ...seg,
    dayOpen,
    high,
    low,
    forecast: hasForecast
      ? [1, 2, 3, 4, 5, 6].map((k) => ({ t: (H + k) * HOUR, v: simForecast(s.metricId, s.regionId, H, H + k) }))
      : [],
  };
}

function dustGrade(pm10: number): string {
  if (pm10 <= 30) return '좋음';
  if (pm10 <= 80) return '보통';
  if (pm10 <= 150) return '나쁨';
  return '매우나쁨';
}

function buildMarket(t: number): MarketState {
  const H = obsHourAt(t);
  const stocks: Record<string, StockState> = {};
  for (const s of STOCKS) stocks[s.id] = stockState(s, t);
  const dust: MarketState['dust'] = {};
  const todayStart = Math.floor(kstDayStart(t) / HOUR);
  for (const r of REGIONS) {
    const avg = (from: number) => {
      let sum = 0;
      for (let h = from; h < from + 24; h++) sum += simValue('pm10', r.id, h);
      return sum / 24;
    };
    dust[r.id] = { today: dustGrade(avg(todayStart)), tomorrow: dustGrade(avg(todayStart + 24)) };
  }
  return {
    updatedAt: H * HOUR + UPDATE_OFFSET,
    obsHour: H * HOUR,
    stocks,
    dust,
    dustSummary: '목업 모드예요. 실제 에어코리아 예보 대신 가짜 값을 보여줘요.',
  };
}

// ── 저장소 ───────────────────────────────────────────

interface MockDB {
  version: 1;
  user: UserDoc;
  holdings: Record<string, Holding>;
  orders: Order[];
  ledger: LedgerEntry[];
  exchanges: Record<string, ExchangeDoc>;
  /** 마지막으로 정산한 00시 */
  settledUntil: number;
}

function load(): MockDB | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const db = JSON.parse(raw) as MockDB;
    return db.version === 1 ? db : null;
  } catch {
    return null;
  }
}

function save(db: MockDB) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(db));
  } catch {
    /* 저장 실패(사생활 보호 모드 등)는 무시하고 메모리에서만 유지 */
  }
}

const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36);

// ── 백엔드 구현 ───────────────────────────────────────

export class MockBackend implements Backend {
  readonly mode = 'mock' as const;
  private db!: MockDB;
  private market!: MarketState;
  private marketHour = -1;
  private marketSubs = new Set<(m: MarketState) => void>();
  private accountSubs = new Set<(a: Account) => void>();
  private timer: ReturnType<typeof setInterval> | undefined;

  async init() {
    const now = Date.now();
    this.db = load() ?? this.fresh(now);
    this.refreshMarket(now, true);
    this.tick(now);
    this.timer ??= setInterval(() => {
      const t = Date.now();
      this.refreshMarket(t);
      this.tick(t);
    }, 1000);
  }

  private fresh(now: number): MockDB {
    const user = newUser('mock-user', randomNickname(), now);
    return {
      version: 1,
      user,
      holdings: {},
      orders: [],
      ledger: [{ id: uid(), type: 'signup', amount: ECONOMY.startCash, at: now, memo: '가입 축하 시작 자금' }],
      exchanges: {},
      settledUntil: kstDayStart(now),
    };
  }

  private refreshMarket(t: number, force = false) {
    const H = obsHourAt(t);
    if (!force && H === this.marketHour) return;
    this.marketHour = H;
    this.market = buildMarket(t);
    this.marketSubs.forEach((cb) => cb(this.market));
  }

  private holdingsList() {
    return Object.values(this.db.holdings);
  }

  private assetsAt(t: number) {
    return totalAssets(this.db.user, this.holdingsList(), (id) => mockPriceAt(id, t));
  }

  /** 00시 정산, 지정가 체결, 자산 갱신 */
  private tick(now: number) {
    const db = this.db;
    let changed = false;
    // 너무 오래 안 켰으면 최근 60일만 정산
    db.settledUntil = Math.max(db.settledUntil, kstDayStart(now) - 60 * DAY);
    while (db.settledUntil + DAY <= now) {
      const midnight = db.settledUntil + DAY;
      this.settleMidnight(midnight);
      db.settledUntil = midnight;
      changed = true;
    }
    for (const o of db.orders) {
      if (o.status !== 'pending') continue;
      const price = mockPriceAt(o.stockId, now);
      if (limitTriggered(o, price)) {
        this.fillPending(o, price, now);
        changed = true;
      }
    }
    const assets = this.assetsAt(now);
    if (assets !== db.user.totalAssets) {
      db.user = { ...db.user, totalAssets: assets };
      changed = true;
    }
    if (changed) this.commit();
  }

  private settleMidnight(midnight: number) {
    const db = this.db;
    // 1) 당일 지정가 주문 만료
    for (const o of db.orders) {
      if (o.status === 'pending' && (o.expiresAt ?? Infinity) <= midnight) {
        const h = db.holdings[o.stockId] ?? emptyHolding(o.stockId, midnight);
        const r = releaseLimit(db.user, h, o);
        db.user = r.user;
        if (db.holdings[o.stockId]) db.holdings[o.stockId] = r.holding;
        o.status = 'expired';
      }
    }
    // 2) 배당
    let total = 0;
    for (const h of this.holdingsList()) {
      const { holding, dividend } = settleDividend(h, midnight, mockPriceAt(h.stockId, midnight));
      total += dividend;
      if (holding.shares === 0 && holding.reserved === 0) delete db.holdings[h.stockId];
      else db.holdings[h.stockId] = holding;
    }
    const dayKey = kstDayKey(midnight - 1);
    if (total > 0) {
      db.user = {
        ...db.user,
        cash: db.user.cash + total,
        totalDividends: db.user.totalDividends + total,
        lastDividend: { day: dayKey, amount: total },
      };
      db.ledger.unshift({ id: uid(), type: 'dividend', amount: total, at: midnight, memo: '00시 보유 배당' });
    }
    // 3) 주간 랭킹 기준 갱신 (월요일 00시)
    db.user = rollWeek(db.user, this.assetsAt(midnight), midnight);
  }

  private fillPending(o: Order, price: number, now: number) {
    const db = this.db;
    const h = db.holdings[o.stockId] ?? emptyHolding(o.stockId, now);
    const fill =
      o.side === 'buy'
        ? execBuy(db.user, h, price, o.qty, now, o.reservedCash ?? 0)
        : execSell(db.user, h, price, o.qty, now, true);
    this.applyFill(o.stockId, o.side, fill, now);
    Object.assign(o, { status: 'filled', filledAt: now, price, fee: fill.fee, amount: fill.amount });
  }

  private applyFill(stockId: string, side: 'buy' | 'sell', fill: ReturnType<typeof execBuy>, now: number) {
    const db = this.db;
    db.user = fill.user;
    db.holdings[stockId] = fill.holding;
    const name = STOCK_BY_ID[stockId].name;
    db.ledger.unshift({
      id: uid(),
      type: side,
      amount: fill.cashDelta,
      at: now,
      memo: `${name} ${fill.qty.toLocaleString()}주 ${side === 'buy' ? '매수' : '매도'}`,
      stockId,
      qty: fill.qty,
      price: fill.price,
      fee: fill.fee,
      profit: fill.profit,
    });
  }

  private commit() {
    const db = this.db;
    db.orders = db.orders.slice(0, 200);
    db.ledger = db.ledger.slice(0, 300);
    save(db);
    const acc = this.account();
    this.accountSubs.forEach((cb) => cb(acc));
  }

  private account(): Account {
    return {
      user: this.db.user,
      holdings: { ...this.db.holdings },
      orders: [...this.db.orders],
      ledger: [...this.db.ledger],
    };
  }

  subscribeMarket(cb: (m: MarketState) => void) {
    this.marketSubs.add(cb);
    cb(this.market);
    return () => void this.marketSubs.delete(cb);
  }

  subscribeAccount(cb: (a: Account) => void) {
    this.accountSubs.add(cb);
    cb(this.account());
    return () => void this.accountSubs.delete(cb);
  }

  async getHistory(stockId: string, from: number, to: number): Promise<PricePoint[]> {
    const s = STOCK_BY_ID[stockId];
    const points: PricePoint[] = [];
    const end = obsHourAt(to);
    for (let h = Math.ceil(from / HOUR); h <= end; h++) {
      points.push({ t: h * HOUR, price: segment(s, h).anchorPrice, value: simValue(s.metricId, s.regionId, h) });
    }
    return points;
  }

  async getRanking(): Promise<Ranking> {
    const now = Date.now();
    const wk = kstWeekKey(now);
    const seed = Number(wk) % 100000;
    const bots: RankingEntry[] = Array.from({ length: 40 }, (_, i) => {
      const r1 = frac(Math.sin((i + 1) * 9301 + seed) * 10000);
      const r2 = frac(Math.sin((i + 7) * 4973 + seed * 3) * 10000);
      const drift = Math.sin(now / 3_600_000 / 5 + i) * 0.02;
      const weeklyReturn = (r1 - 0.42) * 0.6 + drift;
      const totalAssets = Math.round(Math.exp(13 + r2 * 3.2) * (1 + weeklyReturn));
      let s = i * 7919 + 13;
      const rand = () => frac(Math.sin(s++) * 10000);
      return { uid: `bot-${i}`, nickname: randomNickname(rand), totalAssets, weeklyReturn };
    });
    const me: RankingEntry = {
      uid: this.db.user.uid,
      nickname: this.db.user.nickname,
      totalAssets: this.db.user.totalAssets,
      weeklyReturn: weeklyReturn(this.db.user, this.db.user.totalAssets),
    };
    const all = [...bots, me];
    return {
      updatedAt: now,
      weekKey: wk,
      weekly: [...all].sort((a, b) => b.weeklyReturn - a.weeklyReturn),
      total: [...all].sort((a, b) => b.totalAssets - a.totalAssets),
    };
  }

  async placeOrder(req: OrderRequest): Promise<Order> {
    if (!isStockId(req.stockId)) throw new GameError('invalid-stock', '없는 종목이에요.');
    const db = this.db;
    const now = Date.now();
    const price = mockPriceAt(req.stockId, now);
    const h = db.holdings[req.stockId] ?? emptyHolding(req.stockId, now);
    const order: Order = {
      id: uid(),
      stockId: req.stockId,
      side: req.side,
      type: req.type,
      qty: req.qty,
      status: 'pending',
      createdAt: now,
    };
    const marketable =
      req.type === 'market' || (req.limitPrice != null && limitTriggered({ ...order, type: 'limit', limitPrice: req.limitPrice }, price));
    if (req.type === 'limit') order.limitPrice = req.limitPrice;
    if (marketable) {
      const fill = req.side === 'buy' ? execBuy(db.user, h, price, req.qty, now) : execSell(db.user, h, price, req.qty, now);
      this.applyFill(req.stockId, req.side, fill, now);
      Object.assign(order, { status: 'filled', filledAt: now, price, fee: fill.fee, amount: fill.amount });
    } else {
      if (db.orders.filter((o) => o.status === 'pending').length >= ECONOMY.maxOpenOrders) {
        throw new GameError('too-many-orders', `미체결 주문은 ${ECONOMY.maxOpenOrders}개까지 걸어둘 수 있어요.`);
      }
      const r = reserveForLimit(db.user, accrue(h, now), req.side, req.qty, req.limitPrice ?? 0);
      db.user = r.user;
      db.holdings[req.stockId] = r.holding;
      if (r.holding.shares === 0 && r.holding.reserved === 0) delete db.holdings[req.stockId];
      order.reservedCash = r.reservedCash || undefined;
      order.expiresAt = limitExpiry(now);
    }
    db.orders.unshift(order);
    this.commit();
    return order;
  }

  async cancelOrder(orderId: string) {
    const db = this.db;
    const o = db.orders.find((x) => x.id === orderId);
    if (!o || o.status !== 'pending') throw new GameError('not-found', '취소할 수 있는 주문이 없어요.');
    const now = Date.now();
    const h = db.holdings[o.stockId] ?? emptyHolding(o.stockId, now);
    const r = releaseLimit(db.user, h, o);
    db.user = r.user;
    if (db.holdings[o.stockId]) db.holdings[o.stockId] = r.holding;
    o.status = 'cancelled';
    this.commit();
  }

  async toggleWatch(stockId: string) {
    if (!isStockId(stockId)) return;
    const w = this.db.user.watchlist;
    const has = w.includes(stockId);
    if (!has && w.length >= ECONOMY.maxWatchlist) throw new GameError('watch-limit', `관심 종목은 ${ECONOMY.maxWatchlist}개까지예요.`);
    this.db.user = { ...this.db.user, watchlist: has ? w.filter((x) => x !== stockId) : [stockId, ...w] };
    this.commit();
  }

  async setNickname(nickname: string) {
    this.db.user = { ...this.db.user, nickname: validateNickname(nickname) };
    this.commit();
  }

  async requestExchange(points: number) {
    const now = Date.now();
    const r = reserveExchange(this.db.user, points, now);
    const id = uid();
    this.db.user = r.user;
    this.db.exchanges[id] = { id, uid: this.db.user.uid, points, coins: r.coins, status: 'reserved', createdAt: now, dayKey: kstDayKey(now) };
    this.db.ledger.unshift({ id: uid(), type: 'exchange', amount: -r.coins, at: now, memo: `토스포인트 ${points}P로 바꾸기`, points });
    this.commit();
    return { exchangeId: id };
  }

  async confirmExchange(exchangeId: string, rewardKey: string) {
    const ex = this.db.exchanges[exchangeId];
    if (!ex || ex.status !== 'reserved') return;
    this.db.exchanges[exchangeId] = { ...ex, status: 'granted', rewardKey };
    this.commit();
  }

  async cancelExchange(exchangeId: string, reason: string) {
    const ex = this.db.exchanges[exchangeId];
    if (!ex || ex.status !== 'reserved') return;
    this.db.user = refundExchange(this.db.user, ex.points, ex.coins, ex.dayKey);
    this.db.exchanges[exchangeId] = { ...ex, status: 'cancelled', error: reason };
    this.db.ledger.unshift({ id: uid(), type: 'refund', amount: ex.coins, at: Date.now(), memo: '포인트 지급 실패로 돌려받음' });
    this.commit();
  }

  async claimBailout() {
    const now = Date.now();
    checkBailout(this.db.user, this.assetsAt(now), now);
    this.db.user = applyBailout(this.db.user, now);
    this.db.ledger.unshift({ id: uid(), type: 'bailout', amount: ECONOMY.bailoutAmount, at: now, memo: '구제금' });
    this.commit();
  }

  async reset() {
    this.db = this.fresh(Date.now());
    this.commit();
  }
}

const frac = (x: number) => x - Math.floor(x);
