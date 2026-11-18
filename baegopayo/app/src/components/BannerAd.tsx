import { TossAds } from '@apps-in-toss/web-framework';
import { useEffect, useRef, useState } from 'react';
import { BANNER_ID, initBannerAds } from '../lib/ads';

/** 토스 배너 광고 한 칸. 광고를 못 받으면 자리를 차지하지 않아요. */
export function BannerAd() {
  const ref = useRef<HTMLDivElement>(null);
  const [hidden, setHidden] = useState(!BANNER_ID);

  useEffect(() => {
    if (!BANNER_ID) return;
    let destroy: (() => void) | undefined;
    let cancelled = false;

    initBannerAds().then((ok) => {
      if (cancelled) return;
      if (!ok || !ref.current || !TossAds.attachBanner.isSupported()) {
        setHidden(true);
        return;
      }
      try {
        const slot = TossAds.attachBanner(BANNER_ID, ref.current, {
          theme: 'auto',
          variant: 'card',
          callbacks: {
            onNoFill: () => setHidden(true),
            onAdFailedToRender: () => setHidden(true),
          },
        });
        destroy = slot.destroy;
      } catch {
        setHidden(true);
      }
    });

    return () => {
      cancelled = true;
      destroy?.();
    };
  }, []);

  if (hidden) return null;
  return <div ref={ref} className="banner-ad" aria-label="광고" />;
}
