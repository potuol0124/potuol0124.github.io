/**
 * Firebase 백엔드: 시세·계정은 Firestore에서 읽기만 하고,
 * 돈이 오가는 모든 동작은 Cloud Functions(callable)로만 처리해요.
 */
import { initializeApp } from 'firebase/app';
import { connectAuthEmulator, getAuth, signInAnonymously, signInWithCustomToken, type Auth } from 'firebase/auth';
import {
  collection,
  connectFirestoreEmulator,
  doc,
  getDoc,
  getFirestore,
  limit,
  onSnapshot,
  orderBy,
  query,
  type Firestore,
} from 'firebase/firestore';
import { connectFunctionsEmulator, getFunctions, httpsCallable, type Functions } from 'firebase/functions';
import { kstMonthKey, parseKst } from '@shared/time';
import type { Holding, LedgerEntry, MarketState, Order, PricePoint, Ranking, UserDoc } from '@shared/types';
import { isInToss, tossLogin } from '../platform/toss';
import type { Account, Backend, OrderRequest } from './types';

const env = import.meta.env;

export class FirebaseBackend implements Backend {
  readonly mode = 'firebase' as const;
  private auth!: Auth;
  private db!: Firestore;
  private fns!: Functions;
  private uid = '';

  async init() {
    const app = initializeApp({
      apiKey: env.VITE_FIREBASE_API_KEY,
      authDomain: env.VITE_FIREBASE_AUTH_DOMAIN,
      projectId: env.VITE_FIREBASE_PROJECT_ID,
      appId: env.VITE_FIREBASE_APP_ID,
    });
    this.auth = getAuth(app);
    this.db = getFirestore(app);
    this.fns = getFunctions(app, env.VITE_FIREBASE_FUNCTIONS_REGION || 'asia-northeast3');
    if (env.VITE_FIREBASE_EMULATOR === 'true') {
      connectAuthEmulator(this.auth, 'http://127.0.0.1:9099', { disableWarnings: true });
      connectFirestoreEmulator(this.db, '127.0.0.1', 8080);
      connectFunctionsEmulator(this.fns, '127.0.0.1', 5001);
    }
    await this.auth.authStateReady();
    if (!this.auth.currentUser) {
      if (isInToss() && env.VITE_FIREBASE_EMULATOR !== 'true') {
        const { authorizationCode, referrer } = await tossLogin();
        const { customToken } = await this.call<{ customToken: string }>('tossLogin', { authorizationCode, referrer });
        await signInWithCustomToken(this.auth, customToken);
      } else {
        // 토스 밖 또는 에뮬레이터: 익명 로그인. 서버에서 ALLOW_ANONYMOUS=true일 때만 계정이 만들어져요.
        await signInAnonymously(this.auth);
      }
    }
    this.uid = this.auth.currentUser!.uid;
    await this.call('ensureUser', {});
  }

  private async call<T = unknown>(name: string, data: unknown): Promise<T> {
    try {
      const res = await httpsCallable(this.fns, name)(data);
      return res.data as T;
    } catch (e) {
      const err = e as { message?: string };
      throw new Error(err.message || '잠시 후 다시 시도해 주세요.');
    }
  }

  subscribeMarket(cb: (m: MarketState) => void) {
    return onSnapshot(doc(this.db, 'market', 'state'), (snap) => {
      if (snap.exists()) cb(snap.data() as MarketState);
    });
  }

  subscribeAccount(cb: (a: Account) => void) {
    const userRef = doc(this.db, 'users', this.uid);
    let user: UserDoc | undefined;
    let holdings: Record<string, Holding> | undefined;
    let orders: Order[] | undefined;
    let ledger: LedgerEntry[] | undefined;
    const emit = () => {
      if (user && holdings && orders && ledger) cb({ user, holdings, orders, ledger });
    };
    const unsubs = [
      onSnapshot(userRef, (s) => {
        if (s.exists()) {
          user = s.data() as UserDoc;
          emit();
        }
      }),
      onSnapshot(collection(userRef, 'holdings'), (s) => {
        holdings = Object.fromEntries(s.docs.map((d) => [d.id, d.data() as Holding]));
        emit();
      }),
      onSnapshot(query(collection(userRef, 'orders'), orderBy('createdAt', 'desc'), limit(60)), (s) => {
        orders = s.docs.map((d) => d.data() as Order);
        emit();
      }),
      onSnapshot(query(collection(userRef, 'ledger'), orderBy('at', 'desc'), limit(100)), (s) => {
        ledger = s.docs.map((d) => d.data() as LedgerEntry);
        emit();
      }),
    ];
    return () => unsubs.forEach((u) => u());
  }

  private historyCache = new Map<string, { at: number; points: PricePoint[] }>();

  async getHistory(stockId: string, from: number, to: number): Promise<PricePoint[]> {
    const months: string[] = [];
    for (let t = from; ; t += 28 * 86400_000) {
      const k = kstMonthKey(Math.min(t, to));
      if (!months.includes(k)) months.push(k);
      if (t >= to) break;
    }
    const docs = await Promise.all(months.map((m) => this.monthHistory(stockId, m)));
    return docs.flat().filter((p) => p.t >= from && p.t <= to);
  }

  private async monthHistory(stockId: string, month: string): Promise<PricePoint[]> {
    const key = `${stockId}_${month}`;
    const hit = this.historyCache.get(key);
    // 이번 달 문서는 매시간 바뀌니까 5분만 캐시
    if (hit && (month !== kstMonthKey(Date.now()) || Date.now() - hit.at < 5 * 60_000)) return hit.points;
    const snap = await getDoc(doc(this.db, 'history', key));
    const data = snap.data() as { p?: Record<string, number>; v?: Record<string, number> } | undefined;
    const points = Object.entries(data?.p ?? {})
      .map(([ddhh, price]) => ({
        t: parseKst(`${month}${ddhh.slice(0, 2)}`, `${ddhh.slice(2, 4)}00`),
        price,
        value: data?.v?.[ddhh],
      }))
      .sort((a, b) => a.t - b.t);
    this.historyCache.set(key, { at: Date.now(), points });
    return points;
  }

  async getRanking(): Promise<Ranking> {
    const snap = await getDoc(doc(this.db, 'rankings', 'current'));
    return (snap.data() as Ranking) ?? { updatedAt: 0, weekKey: '', weekly: [], total: [] };
  }

  placeOrder(req: OrderRequest) {
    return this.call<Order>('placeOrder', req);
  }
  async cancelOrder(orderId: string) {
    await this.call('cancelOrder', { orderId });
  }
  async toggleWatch(stockId: string) {
    await this.call('toggleWatch', { stockId });
  }
  async setNickname(nickname: string) {
    await this.call('setNickname', { nickname });
  }
  requestExchange(points: number) {
    return this.call<{ exchangeId: string }>('requestExchange', { points });
  }
  async confirmExchange(exchangeId: string, rewardKey: string) {
    await this.call('confirmExchange', { exchangeId, rewardKey });
  }
  async cancelExchange(exchangeId: string, reason: string) {
    await this.call('cancelExchange', { exchangeId, reason });
  }
  async claimBailout() {
    await this.call('claimBailout', {});
  }
}
