/**
 * 앱인토스 SDK 래퍼.
 * - 토스 앱 안: 실제 SDK 호출
 * - `vite` 개발 서버: @apps-in-toss/devtools가 SDK를 mock으로 바꿔 줘요
 * - 그 밖의 일반 브라우저: SDK 호출이 실패하면 개발용 대체 동작을 해요
 */
import {
  appLogin,
  generateHapticFeedback,
  getOperationalEnvironment,
  loadFullScreenAd,
  openURL,
  Promotion,
  showFullScreenAd,
  TossAds,
} from '@apps-in-toss/web-framework';

const env = import.meta.env;

export const TOSS_CONFIG = {
  promotionCode: env.VITE_TOSS_PROMOTION_CODE ?? '',
  bannerAdGroupId: env.VITE_AD_BANNER_GROUP_ID ?? '',
  rewardedAdGroupId: env.VITE_AD_REWARDED_GROUP_ID ?? '',
};

let cachedEnv: 'toss' | 'sandbox' | 'browser' | undefined;

export function runtimeEnv(): 'toss' | 'sandbox' | 'browser' {
  if (cachedEnv) return cachedEnv;
  try {
    cachedEnv = getOperationalEnvironment() ?? 'browser';
  } catch {
    cachedEnv = 'browser';
  }
  return cachedEnv;
}

export const isInToss = () => runtimeEnv() !== 'browser';

export function haptic(type: 'tap' | 'success' | 'error' | 'tickWeak' | 'confetti' = 'tap') {
  try {
    void generateHapticFeedback({ type }).catch(() => {});
  } catch {
    /* 브라우저에서는 무시 */
  }
}

/** 토스 로그인 → 서버에서 토큰 교환에 쓸 인가 코드 */
export async function tossLogin(): Promise<{ authorizationCode: string; referrer: 'DEFAULT' | 'SANDBOX' }> {
  return appLogin();
}

/**
 * 토스포인트 지급. 콘솔 프로모션 코드와 금액(포인트)을 넘겨요.
 * 성공 시 지급 key를 돌려줘요. 실패하면 Error를 던져요.
 */
export async function grantTossPoints(amount: number): Promise<string> {
  const supported = (() => {
    try {
      return Promotion.grantReward.isSupported();
    } catch {
      return false;
    }
  })();
  if (!supported) {
    if (import.meta.env.DEV || !isInToss()) {
      await delay(700);
      return `dev-${Date.now()}`;
    }
    throw new Error('토스 앱을 최신 버전으로 업데이트한 뒤 다시 시도해 주세요.');
  }
  if (!TOSS_CONFIG.promotionCode) {
    // 로컬 개발(devtools mock)에서는 코드 없이도 지급 성공 흐름을 볼 수 있게 해요
    if (import.meta.env.DEV) {
      await delay(700);
      return `dev-${Date.now()}`;
    }
    throw new Error('프로모션 코드가 설정되지 않았어요.');
  }
  const result = await Promotion.grantReward({ promotionCode: TOSS_CONFIG.promotionCode, amount });
  if (!result?.key) throw new Error('포인트 지급에 실패했어요.');
  return result.key;
}

/** 보상형 광고. 끝까지 봐서 보상 조건을 채우면 true */
export function showRewardedAd(): Promise<boolean> {
  const groupId = TOSS_CONFIG.rewardedAdGroupId;
  let supported = false;
  try {
    supported = loadFullScreenAd.isSupported() && showFullScreenAd.isSupported() && !!groupId;
  } catch {
    supported = false;
  }
  if (!supported) {
    // 개발 환경: 광고를 본 것으로 처리
    return delay(1200).then(() => true);
  }
  return new Promise((resolve) => {
    let earned = false;
    let done = false;
    const finish = (v: boolean) => {
      if (done) return;
      done = true;
      resolve(v);
    };
    const unload = loadFullScreenAd({
      options: { adGroupId: groupId },
      onEvent: (e) => {
        if (e.type !== 'loaded') return;
        showFullScreenAd({
          options: { adGroupId: groupId },
          onEvent: (ev) => {
            if (ev.type === 'userEarnedReward') earned = true;
            if (ev.type === 'dismissed') finish(earned);
            if (ev.type === 'failedToShow') finish(false);
          },
          onError: () => finish(false),
        });
      },
      onError: () => finish(false),
    });
    // 90초 안에 끝나지 않으면 그때까지의 결과로 마무리
    setTimeout(() => {
      unload?.();
      finish(earned);
    }, 90_000);
  });
}

let adsInitialized: Promise<boolean> | null = null;

function initAds(): Promise<boolean> {
  if (adsInitialized) return adsInitialized;
  adsInitialized = new Promise((resolve) => {
    try {
      if (!TossAds.initialize.isSupported()) return resolve(false);
      TossAds.initialize({
        callbacks: { onInitialized: () => resolve(true), onInitializationFailed: () => resolve(false) },
      });
    } catch {
      resolve(false);
    }
  });
  return adsInitialized;
}

/** 배너 광고를 target에 붙여요. 지원하지 않으면 false */
export async function attachBannerAd(target: HTMLElement, theme: 'light' | 'dark'): Promise<null | (() => void)> {
  if (!TOSS_CONFIG.bannerAdGroupId) return null;
  const ok = await initAds();
  if (!ok) return null;
  try {
    if (!TossAds.attachBanner.isSupported()) return null;
    const r = TossAds.attachBanner(TOSS_CONFIG.bannerAdGroupId, target, { theme, variant: 'card', tone: 'grey' });
    return () => r.destroy();
  } catch {
    return null;
  }
}

export function delay(ms: number) {
  return new Promise<void>((r) => setTimeout(r, ms));
}

/** 외부 링크 열기 (토스 앱 안에서는 SDK openURL) */
export function openExternal(url: string) {
  if (isInToss()) {
    openURL(url).catch(() => window.open(url, '_blank'));
    return;
  }
  window.open(url, '_blank', 'noopener');
}
