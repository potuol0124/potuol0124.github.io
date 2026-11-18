/**
 * 날씨증권 Cloud Functions (서울 리전)
 *
 * 스케줄
 *  - collectWeatherJob : 매시 50분, 날씨 수집 → 시세 갱신 → 랭킹 집계
 *  - dailySettlementJob: 매일 00:00, 배당 지급·지정가 만료·주간 기준 갱신
 *  - matchLimitOrdersJob: 매분, 지정가 주문 체결
 * callable (앱에서 호출)
 *  - tossLogin, ensureUser, placeOrder, cancelOrder, toggleWatch, setNickname,
 *    claimBailout, requestExchange, confirmExchange, cancelExchange
 */
import { defineSecret } from 'firebase-functions/params';
import { setGlobalOptions } from 'firebase-functions/v2';
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import * as account from './account';
import { collectWeather } from './collect';
import { getMarket, requireUid, wrap } from './db';
import { updateRankings } from './ranking';
import { dailySettlement } from './settle';
import * as toss from './toss';
import * as trading from './trading';

setGlobalOptions({ region: 'asia-northeast3', maxInstances: 10 });

/** 공공데이터포털 일반 인증키 (Decoding 키). 기상청·에어코리아 모두 같은 키로 활용신청하세요. */
const DATA_GO_KR_KEY = defineSecret('DATA_GO_KR_KEY');
const TOSS_MTLS_CERT = defineSecret('TOSS_MTLS_CERT');
const TOSS_MTLS_KEY = defineSecret('TOSS_MTLS_KEY');

const TZ = 'Asia/Seoul';

// ── 스케줄 ───────────────────────────────────────────

export const collectWeatherJob = onSchedule(
  { schedule: '50 * * * *', timeZone: TZ, secrets: [DATA_GO_KR_KEY], timeoutSeconds: 300, memory: '512MiB', retryCount: 1 },
  async () => {
    await collectWeather(DATA_GO_KR_KEY.value());
    await updateRankings(await getMarket());
  },
);

export const dailySettlementJob = onSchedule(
  { schedule: '0 0 * * *', timeZone: TZ, timeoutSeconds: 540, memory: '1GiB', retryCount: 3 },
  async () => {
    await dailySettlement();
  },
);

export const matchLimitOrdersJob = onSchedule({ schedule: '* * * * *', timeZone: TZ, timeoutSeconds: 55 }, async () => {
  await trading.matchLimitOrders();
});

// ── callable ─────────────────────────────────────────

const opts = { enforceAppCheck: false, cors: true };

export const tossLogin = onCall({ ...opts, secrets: [TOSS_MTLS_CERT, TOSS_MTLS_KEY] }, (req) =>
  toss.tossLogin(req.data ?? {}, { cert: TOSS_MTLS_CERT.value(), key: TOSS_MTLS_KEY.value() }),
);

export const ensureUser = onCall(opts, (req) =>
  wrap(async () => {
    const uid = requireUid(req.auth);
    const provider = req.auth?.token.firebase?.sign_in_provider;
    // 운영에서는 토스 로그인(custom token)만 게임 계정을 만들 수 있어요
    if (provider === 'anonymous' && process.env.ALLOW_ANONYMOUS !== 'true') {
      throw new HttpsError('permission-denied', '토스 앱에서 열어 주세요.');
    }
    await account.ensureUser(uid);
    return { ok: true };
  }),
);

export const placeOrder = onCall(opts, (req) => wrap(() => trading.placeOrder(requireUid(req.auth), req.data)));

export const cancelOrder = onCall(opts, (req) =>
  wrap(async () => {
    await trading.cancelOrder(requireUid(req.auth), req.data?.orderId);
    return { ok: true };
  }),
);

export const toggleWatch = onCall(opts, (req) =>
  wrap(async () => {
    await account.toggleWatch(requireUid(req.auth), req.data?.stockId);
    return { ok: true };
  }),
);

export const setNickname = onCall(opts, (req) =>
  wrap(async () => {
    await account.setNickname(requireUid(req.auth), req.data?.nickname);
    return { ok: true };
  }),
);

export const claimBailout = onCall(opts, (req) =>
  wrap(async () => {
    await account.claimBailout(requireUid(req.auth));
    return { ok: true };
  }),
);

export const requestExchange = onCall(opts, (req) => wrap(() => account.requestExchange(requireUid(req.auth), req.data?.points)));

export const confirmExchange = onCall(opts, (req) =>
  wrap(async () => {
    await account.confirmExchange(requireUid(req.auth), req.data?.exchangeId, req.data?.rewardKey);
    return { ok: true };
  }),
);

export const cancelExchange = onCall(opts, (req) =>
  wrap(async () => {
    await account.cancelExchange(requireUid(req.auth), req.data?.exchangeId, req.data?.reason);
    return { ok: true };
  }),
);
