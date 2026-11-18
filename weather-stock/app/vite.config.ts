import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import aitDevtools from '@apps-in-toss/devtools/unplugin';
import { fileURLToPath } from 'node:url';

// 개발 서버에서는 devtools가 앱인토스 SDK를 브라우저용 mock으로 바꿔 줘요(프로덕션 빌드에는 포함되지 않아요).
export default defineConfig({
  plugins: [react(), aitDevtools.vite()],
  resolve: {
    alias: {
      '@shared': fileURLToPath(new URL('../shared', import.meta.url)),
    },
  },
  server: {
    host: true,
    port: 5173,
    fs: { allow: ['..'] },
  },
  build: {
    outDir: 'dist',
    target: 'es2020',
  },
});
