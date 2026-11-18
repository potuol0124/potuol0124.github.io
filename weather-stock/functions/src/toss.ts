/**
 * 토스 로그인 (서버 측). 앱인토스 파트너 API는 mTLS 인증서가 필요해요.
 * 콘솔에서 발급받은 인증서·키(PEM)를 Secret Manager에 TOSS_MTLS_CERT, TOSS_MTLS_KEY로 넣어 주세요.
 *
 * ⚠️ 엔드포인트 경로와 응답 형식은 출시 전에 앱인토스 개발자 문서의 '토스 로그인' 항목과 꼭 대조하세요.
 */
import { request } from 'node:https';
import { getAuth } from 'firebase-admin/auth';
import { HttpsError } from 'firebase-functions/v2/https';

const API_BASE = process.env.TOSS_API_BASE || 'https://apps-in-toss-api.toss.im';

interface TossEnvelope<T> {
  resultType: 'SUCCESS' | 'FAIL';
  success?: T;
  error?: { errorCode?: string; reason?: string };
}

function tossRequest<T>(
  path: string,
  opts: { method: 'GET' | 'POST'; body?: unknown; headers?: Record<string, string>; cert: string; key: string },
): Promise<T> {
  const url = new URL(path, API_BASE);
  const payload = opts.body ? JSON.stringify(opts.body) : undefined;
  return new Promise((resolve, reject) => {
    const req = request(
      url,
      {
        method: opts.method,
        cert: opts.cert,
        key: opts.key,
        timeout: 10_000,
        headers: {
          'Content-Type': 'application/json',
          ...(payload ? { 'Content-Length': Buffer.byteLength(payload).toString() } : {}),
          ...opts.headers,
        },
      },
      (res) => {
        let data = '';
        res.on('data', (c) => (data += c));
        res.on('end', () => {
          try {
            const json = JSON.parse(data) as TossEnvelope<T>;
            if (json.resultType !== 'SUCCESS' || !json.success) {
              reject(new Error(`토스 API 실패 ${res.statusCode} ${json.error?.errorCode ?? ''} ${json.error?.reason ?? data.slice(0, 200)}`));
            } else resolve(json.success);
          } catch {
            reject(new Error(`토스 API 응답 오류 ${res.statusCode}: ${data.slice(0, 200)}`));
          }
        });
      },
    );
    req.on('timeout', () => req.destroy(new Error('토스 API 시간 초과')));
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

export async function tossLogin(
  input: { authorizationCode?: unknown; referrer?: unknown },
  creds: { cert: string; key: string },
): Promise<{ customToken: string }> {
  const authorizationCode = String(input?.authorizationCode ?? '');
  const referrer = input?.referrer === 'SANDBOX' ? 'SANDBOX' : 'DEFAULT';
  if (!authorizationCode) throw new HttpsError('invalid-argument', '로그인 정보가 없어요.');
  try {
    const token = await tossRequest<{ accessToken: string }>('/api-partner/v1/apps-in-toss/user/oauth2/generate-token', {
      method: 'POST',
      body: { authorizationCode, referrer },
      ...creds,
    });
    const me = await tossRequest<{ userKey: number | string }>('/api-partner/v1/apps-in-toss/user/oauth2/login-me', {
      method: 'GET',
      headers: { Authorization: `Bearer ${token.accessToken}` },
      ...creds,
    });
    const uid = `toss_${me.userKey}`;
    const customToken = await getAuth().createCustomToken(uid, { provider: 'toss', sandbox: referrer === 'SANDBOX' });
    return { customToken };
  } catch (e) {
    console.error('토스 로그인 실패', e);
    throw new HttpsError('unauthenticated', '토스 로그인에 실패했어요. 다시 시도해 주세요.');
  }
}
