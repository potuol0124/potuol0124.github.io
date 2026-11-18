// shared/ 코드를 함께 묶어서 lib/index.js 하나로 빌드해요 (배포 시 functions 폴더만 올라가기 때문).
import { build } from 'esbuild';

await build({
  entryPoints: ['src/index.ts'],
  outfile: 'lib/index.js',
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'cjs',
  sourcemap: true,
  external: ['firebase-admin', 'firebase-functions'],
  logLevel: 'info',
});
