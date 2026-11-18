/**
 * 아주 작은 스택 라우터. 화면을 쌓을 때 history.pushState를 같이 해서
 * 토스 내비게이션 바의 뒤로가기·안드로이드 뒤로가기가 자연스럽게 동작해요.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { OrderSide } from '@shared/types';

export type Tab = 'home' | 'account' | 'ranking' | 'benefit';

export type Route =
  | { name: 'stock'; id: string }
  | { name: 'order'; id: string; side: OrderSide }
  | { name: 'ledger' }
  | { name: 'orders' }
  | { name: 'rules' }
  | { name: 'search' };

interface RouterApi {
  tab: Tab;
  setTab: (t: Tab) => void;
  stack: Route[];
  push: (r: Route) => void;
  /** 현재 화면을 r로 바꿔요 (뒤로가기 기록을 늘리지 않음) */
  replace: (r: Route) => void;
  back: () => void;
}

const RouterCtx = createContext<RouterApi | null>(null);

export function RouterProvider({ children }: { children: ReactNode }) {
  const [tab, setTabState] = useState<Tab>('home');
  const [stack, setStack] = useState<Route[]>([]);

  useEffect(() => {
    history.replaceState({ depth: 0 }, '');
    const onPop = (e: PopStateEvent) => {
      const depth = (e.state as { depth?: number } | null)?.depth ?? 0;
      setStack((s) => s.slice(0, depth));
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  const depthRef = useRef(0);
  depthRef.current = stack.length;

  const push = useCallback((r: Route) => {
    // pushState는 상태 업데이트 함수 밖에서 한 번만 (StrictMode는 업데이트 함수를 두 번 실행해요)
    const depth = depthRef.current + 1;
    depthRef.current = depth;
    history.pushState({ depth }, '');
    setStack((s) => [...s.slice(0, depth - 1), r]);
  }, []);

  const replace = useCallback((r: Route) => {
    setStack((s) => (s.length ? [...s.slice(0, -1), r] : s));
  }, []);

  const back = useCallback(() => history.back(), []);

  const setTab = useCallback((t: Tab) => {
    setTabState(t);
    window.scrollTo(0, 0);
  }, []);

  const api = useMemo(() => ({ tab, setTab, stack, push, replace, back }), [tab, setTab, stack, push, replace, back]);
  return <RouterCtx.Provider value={api}>{children}</RouterCtx.Provider>;
}

export function useRouter() {
  const r = useContext(RouterCtx);
  if (!r) throw new Error('RouterProvider 밖이에요.');
  return r;
}
