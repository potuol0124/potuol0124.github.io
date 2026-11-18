import { TossAds, loadFullScreenAd, showFullScreenAd } from '@apps-in-toss/web-framework';

export const BANNER_ID = (import.meta.env.VITE_AD_BANNER_ID as string | undefined) || '';
const INTERSTITIAL_ID = (import.meta.env.VITE_AD_INTERSTITIAL_ID as string | undefined) || '';
const INTERSTITIAL_EVERY = Math.max(
  1,
  Number(import.meta.env.VITE_AD_INTERSTITIAL_EVERY ?? 3) || 3,
);

function supported(fn: { isSupported: () => boolean }): boolean {
  try {
    return fn.isSupported();
  } catch {
    return false;
  }
}

// ---------- 배너 광고 (TossAds)

let bannerInit: Promise<boolean> | null = null;

/** 배너 광고 SDK 초기화. 한 번만 실행돼요. 광고를 쓸 수 없는 환경이면 false. */
export function initBannerAds(): Promise<boolean> {
  if (!BANNER_ID || !supported(TossAds.initialize)) return Promise.resolve(false);
  bannerInit ??= new Promise<boolean>((resolve) => {
    try {
      TossAds.initialize({
        callbacks: {
          onInitialized: () => resolve(true),
          onInitializationFailed: () => resolve(false),
        },
      });
    } catch {
      resolve(false);
    }
  });
  return bannerInit;
}

// ---------- 전면 광고 (loadFullScreenAd / showFullScreenAd)

let interstitialReady = false;
let interstitialLoading = false;
let searchCount = 0;

/** 다음에 보여줄 전면 광고를 미리 불러와요. */
export function preloadInterstitial(): void {
  if (!INTERSTITIAL_ID || interstitialReady || interstitialLoading) return;
  if (!supported(loadFullScreenAd)) return;
  interstitialLoading = true;
  try {
    loadFullScreenAd({
      options: { adGroupId: INTERSTITIAL_ID },
      onEvent: (e) => {
        if (e.type === 'loaded') {
          interstitialReady = true;
          interstitialLoading = false;
        }
      },
      onError: () => {
        interstitialLoading = false;
      },
    });
  } catch {
    interstitialLoading = false;
  }
}

/**
 * 검색할 때마다 호출해요. INTERSTITIAL_EVERY 번째 검색마다, 광고가 준비돼 있으면
 * 전면 광고를 보여주고 닫힐 때까지 기다려요. 광고가 없으면 바로 끝나요.
 */
export function maybeShowInterstitial(): Promise<void> {
  searchCount += 1;
  if (searchCount % INTERSTITIAL_EVERY !== 0 || !interstitialReady) {
    preloadInterstitial();
    return Promise.resolve();
  }
  interstitialReady = false;
  return new Promise<void>((resolve) => {
    const done = () => {
      preloadInterstitial();
      resolve();
    };
    try {
      showFullScreenAd({
        options: { adGroupId: INTERSTITIAL_ID },
        onEvent: (e) => {
          if (e.type === 'dismissed' || e.type === 'failedToShow') done();
        },
        onError: done,
      });
    } catch {
      done();
    }
  });
}
