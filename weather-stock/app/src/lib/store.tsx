import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { priceAt } from '@shared/engine';
import type { MarketState } from '@shared/types';
import { createBackend, type Account, type Backend } from '../backend';

interface Store {
  backend: Backend;
  market: MarketState;
  account: Account;
}

const StoreCtx = createContext<Store | null>(null);

export function StoreProvider({ children, fallback }: { children: ReactNode; fallback: (error?: string, retry?: () => void) => ReactNode }) {
  const [backend, setBackend] = useState<Backend>();
  const [market, setMarket] = useState<MarketState>();
  const [account, setAccount] = useState<Account>();
  const [error, setError] = useState<string>();
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let unsubs: (() => void)[] = [];
    let cancelled = false;
    setError(undefined);
    (async () => {
      try {
        const b = await createBackend();
        await b.init();
        if (cancelled) return;
        setBackend(b);
        unsubs = [b.subscribeMarket(setMarket), b.subscribeAccount(setAccount)];
      } catch (e) {
        console.error(e);
        if (!cancelled) setError((e as Error).message || '연결에 실패했어요.');
      }
    })();
    return () => {
      cancelled = true;
      unsubs.forEach((u) => u());
    };
  }, [attempt]);

  if (!backend || !market || !account) return <>{fallback(error, () => setAttempt((a) => a + 1))}</>;
  return <StoreCtx.Provider value={{ backend, market, account }}>{children}</StoreCtx.Provider>;
}

export function useStore() {
  const s = useContext(StoreCtx);
  if (!s) throw new Error('StoreProvider 밖에서 useStore를 썼어요.');
  return s;
}

/** intervalMs마다 다시 그리는 현재 시각 */
export function useNow(intervalMs = 1000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}

/** 현재가 조회 함수 */
export function usePrices(now: number) {
  const { market } = useStore();
  return useCallback(
    (stockId: string) => {
      const s = market.stocks[stockId];
      return s ? priceAt(s, now) : 0;
    },
    [market, now],
  );
}

/** 값이 바뀔 때 잠깐 'flash-up' / 'flash-down' 클래스를 줘요 */
export function useFlash(value: number) {
  const prev = useRef(value);
  const [cls, setCls] = useState('');
  useEffect(() => {
    if (value === prev.current) return;
    setCls(value > prev.current ? 'flash-up' : 'flash-down');
    prev.current = value;
    const id = setTimeout(() => setCls(''), 600);
    return () => clearTimeout(id);
  }, [value]);
  return cls;
}

// ── 토스트 ───────────────────────────────────────────

interface ToastApi {
  show: (msg: string) => void;
}
const ToastCtx = createContext<ToastApi>({ show: () => {} });

export function ToastProvider({ children }: { children: ReactNode }) {
  const [msg, setMsg] = useState<{ text: string; key: number }>();
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const api = useMemo<ToastApi>(
    () => ({
      show: (text) => {
        setMsg({ text, key: Date.now() });
        clearTimeout(timer.current);
        timer.current = setTimeout(() => setMsg(undefined), 2400);
      },
    }),
    [],
  );
  return (
    <ToastCtx.Provider value={api}>
      {children}
      {msg && (
        <div className="toast" key={msg.key} role="status">
          {msg.text}
        </div>
      )}
    </ToastCtx.Provider>
  );
}

export const useToast = () => useContext(ToastCtx);
