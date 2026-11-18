/** 공공데이터포털은 가끔 느리거나 XML 에러를 돌려줘서, 타임아웃과 재시도를 둬요. */
export async function fetchJson<T>(url: string, tries = 3): Promise<T> {
  let lastErr: unknown;
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
      const text = await res.text();
      if (!res.ok) throw new Error(`HTTP ${res.status}: ${text.slice(0, 200)}`);
      if (text.trimStart().startsWith('<')) throw new Error(`XML 응답(키·트래픽 오류 가능): ${text.slice(0, 200)}`);
      return JSON.parse(text) as T;
    } catch (e) {
      lastErr = e;
      await new Promise((r) => setTimeout(r, 500 * (i + 1)));
    }
  }
  throw lastErr;
}
