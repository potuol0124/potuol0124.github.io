import { defineConfig } from '@apps-in-toss/web-framework/config';

export default defineConfig({
  // 앱인토스 콘솔에 등록한 앱 이름(케밥-케이스)과 같아야 해요.
  appName: 'weather-stock',
  permissions: [],
  navigationBar: {
    withBackButton: true,
    withHomeButton: true,
    withTitle: true,
  },
  webView: {
    bounces: false,
    pullToRefreshEnabled: false,
    overScrollMode: 'never',
  },
  webBundleDir: 'dist',
});
