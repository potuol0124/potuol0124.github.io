import { initializeApp } from 'firebase-admin/app';
import { getFirestore, type DocumentReference, type Transaction, type UpdateData } from 'firebase-admin/firestore';
import { HttpsError } from 'firebase-functions/v2/https';
import { GameError } from '../../shared/engine';
import type { Holding, MarketState, UserDoc } from '../../shared/types';

initializeApp();
export const db = getFirestore();
db.settings({ ignoreUndefinedProperties: true });

export const refs = {
  market: () => db.doc('market/state') as DocumentReference<MarketState>,
  user: (uid: string) => db.doc(`users/${uid}`) as DocumentReference<UserDoc>,
  holding: (uid: string, stockId: string) => db.doc(`users/${uid}/holdings/${stockId}`) as DocumentReference<Holding>,
  orders: (uid: string) => db.collection(`users/${uid}/orders`),
  ledger: (uid: string) => db.collection(`users/${uid}/ledger`),
  history: (stockId: string, month: string) => db.doc(`history/${stockId}_${month}`),
  ranking: () => db.doc('rankings/current'),
  exchange: (id: string) => db.doc(`exchanges/${id}`),
};

export async function getMarket(tx?: Transaction): Promise<MarketState> {
  const snap = tx ? await tx.get(refs.market()) : await refs.market().get();
  const m = snap.data();
  if (!m) throw new HttpsError('unavailable', '시세를 준비하고 있어요. 잠시 후 다시 시도해 주세요.');
  return m;
}

export async function getUser(tx: Transaction, uid: string): Promise<UserDoc> {
  const snap = await tx.get(refs.user(uid));
  const u = snap.data();
  if (!u) throw new HttpsError('not-found', '계정을 찾을 수 없어요. 앱을 다시 열어 주세요.');
  return u;
}

/** 바뀐 필드만 골라 써서, 다른 작업(랭킹 집계 등)이 쓴 필드를 덮어쓰지 않게 해요 */
export function diff<T extends object>(before: T, after: T): Partial<T> {
  const out: Partial<T> = {};
  for (const k of Object.keys(after) as (keyof T)[]) {
    if (JSON.stringify(before[k]) !== JSON.stringify(after[k])) out[k] = after[k];
  }
  return out;
}

/** 바뀐 필드가 있을 때만 update (빈 update는 Firestore가 거부해요) */
export function updateChanged<T extends object>(tx: Transaction, ref: DocumentReference<T>, before: T, after: T) {
  const patch = diff(before, after);
  if (Object.keys(patch).length) tx.update(ref, patch as UpdateData<T>);
}

/** GameError → 클라이언트에 보여줄 HttpsError */
export function wrap<T>(fn: () => Promise<T>): Promise<T> {
  return fn().catch((e) => {
    if (e instanceof GameError) throw new HttpsError('failed-precondition', e.message, { code: e.code });
    if (e instanceof HttpsError) throw e;
    console.error(e);
    throw new HttpsError('internal', '잠시 후 다시 시도해 주세요.');
  });
}

export function requireUid(auth: { uid: string } | undefined): string {
  if (!auth?.uid) throw new HttpsError('unauthenticated', '로그인이 필요해요.');
  return auth.uid;
}

/** 동시에 limit개씩 실행 */
export async function pool<T>(items: T[], limit: number, fn: (item: T) => Promise<void>) {
  let i = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) {
      const item = items[i++];
      await fn(item);
    }
  });
  await Promise.all(workers);
}
