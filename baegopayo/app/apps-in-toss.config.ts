import { defineConfig } from '@apps-in-toss/web-framework/config';

export default defineConfig({
  // 앱인토스 콘솔에 등록한 앱 이름과 같아야 해요.
  appName: 'baegopayo',
  // 현재 위치 기준으로 근처 식당을 찾기 때문에 위치 권한이 필요해요.
  permissions: [{ name: 'geolocation', access: 'access' }],
  navigationBar: {
    withBackButton: true,
    withHomeButton: true,
  },
  webBundleDir: 'dist',
});
