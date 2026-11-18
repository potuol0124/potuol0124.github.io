/// <reference types="vite/client" />
interface ImportMetaEnv {
  readonly VITE_BACKEND?: 'mock' | 'firebase';
  readonly VITE_FIREBASE_API_KEY?: string;
  readonly VITE_FIREBASE_AUTH_DOMAIN?: string;
  readonly VITE_FIREBASE_PROJECT_ID?: string;
  readonly VITE_FIREBASE_APP_ID?: string;
  readonly VITE_FIREBASE_FUNCTIONS_REGION?: string;
  readonly VITE_FIREBASE_EMULATOR?: string;
  readonly VITE_TOSS_PROMOTION_CODE?: string;
  readonly VITE_AD_BANNER_GROUP_ID?: string;
  readonly VITE_AD_REWARDED_GROUP_ID?: string;
}
interface ImportMeta {
  readonly env: ImportMetaEnv;
}
