import { useEffect, useRef, useState, type ReactNode } from 'react';
import { changeRate } from '@shared/market';
import { METRIC_BY_ID, formatValue } from '@shared/metrics';
import { STOCK_BY_ID } from '@shared/stocks';
import { attachBannerAd, isInToss } from '../platform/toss';
import { dir, num, pct } from '../lib/format';
import { useRouter, type Tab } from '../lib/router';
import { useFlash, useStore } from '../lib/store';

// ── 아이콘 ───────────────────────────────────────────

export const Icon = {
  back: (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M15 5l-7 7 7 7" />
    </svg>
  ),
  chev: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
      <path d="M9 5l7 7-7 7" />
    </svg>
  ),
  search: (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
      <circle cx="11" cy="11" r="7" />
      <path d="M20 20l-3.5-3.5" />
    </svg>
  ),
  heart: (on: boolean) => (
    <svg width="24" height="24" viewBox="0 0 24 24" fill={on ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2">
      <path d="M12 20s-7-4.5-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.5-7 10-7 10z" strokeLinejoin="round" />
    </svg>
  ),
  sort: (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
      <path d="M7 4v16M3 16l4 4 4-4M17 20V4M13 8l4-4 4 4" />
    </svg>
  ),
};

const TabIcon: Record<Tab, ReactNode> = {
  home: (
    <svg viewBox="0 0 24 24" fill="currentColor">
      <path d="M3.5 10.2 12 3.5l8.5 6.7V20a1 1 0 0 1-1 1h-5v-6h-5v6h-5a1 1 0 0 1-1-1z" />
    </svg>
  ),
  account: (
    <svg viewBox="0 0 24 24" fill="currentColor">
      <path d="M4 13h3.5v8H4zM10.25 8h3.5v13h-3.5zM16.5 3H20v18h-3.5z" />
    </svg>
  ),
  ranking: (
    <svg viewBox="0 0 24 24" fill="currentColor">
      <path d="M7 3h10v2h3v3a4 4 0 0 1-4 4h-.3A5 5 0 0 1 13 14.9V18h3v3H8v-3h3v-3.1A5 5 0 0 1 8.3 12H8a4 4 0 0 1-4-4V5h3zm0 4H6v1a2 2 0 0 0 1 1.7zm10 0v2.7A2 2 0 0 0 18 8V7z" />
    </svg>
  ),
  benefit: (
    <svg viewBox="0 0 24 24" fill="currentColor">
      <path d="M4 10h16v11H4zM2.5 6.5h19V10h-19zM11 6.5h2V21h-2zM12 6.3C10.6 3.5 7 3 7 5.2 7 6.6 9.5 6.5 12 6.5zm0 0c1.4-2.8 5-3.3 5-1.1 0 1.4-2.5 1.3-5 1.3z" />
    </svg>
  ),
};

const TAB_LABEL: Record<Tab, string> = { home: '홈', account: '내 계좌', ranking: '랭킹', benefit: '혜택' };

export function TabBar() {
  const { tab, setTab } = useRouter();
  return (
    <nav className="tabbar" aria-label="메인 메뉴">
      {(Object.keys(TAB_LABEL) as Tab[]).map((t) => (
        <button key={t} className={tab === t ? 'on' : ''} onClick={() => setTab(t)} aria-current={tab === t ? 'page' : undefined}>
          {TabIcon[t]}
          {TAB_LABEL[t]}
        </button>
      ))}
    </nav>
  );
}

/** 하위 화면 헤더. 토스 앱 안에서는 내비게이션 바가 뒤로가기를 제공하니까 숨겨요. */
export function TopBar({ title, right }: { title?: ReactNode; right?: ReactNode }) {
  const { back } = useRouter();
  const showBack = !isInToss();
  return (
    <header className="topbar">
      {showBack && (
        <button className="iconbtn" onClick={back} aria-label="뒤로">
          {Icon.back}
        </button>
      )}
      <div className="title">{title}</div>
      {right}
    </header>
  );
}

// ── 종목 줄 ─────────────────────────────────────────

export function StockRow({ id, price, rank, extra }: { id: string; price: number; rank?: number; extra?: ReactNode }) {
  const { market } = useStore();
  const { push } = useRouter();
  const s = STOCK_BY_ID[id];
  const st = market.stocks[id];
  const m = METRIC_BY_ID[s.metricId];
  const r = st ? changeRate(price, st.dayOpen) : 0;
  const flash = useFlash(price);
  return (
    <li>
      <button className="row" onClick={() => push({ name: 'stock', id })}>
        {rank != null && <span className="rank">{rank}</span>}
        <span className="icon" aria-hidden>
          {m.emoji}
        </span>
        <span className="main">
          <div className="name">{s.name}</div>
          <div className="desc">{extra ?? `현재 ${formatValue(m, st?.value)}`}</div>
        </span>
        <span className="end">
          <div className={`price tnum ${flash}`}>{num(price)}날로</div>
          <div className={`rate tnum ${dir(r)}`}>{pct(r)}</div>
        </span>
      </button>
    </li>
  );
}

// ── 바텀시트 ─────────────────────────────────────────

export function Sheet({ children, onClose }: { children: ReactNode; onClose: () => void }) {
  return (
    <div className="sheet-bg" onClick={onClose} role="dialog" aria-modal>
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
        {children}
      </div>
    </div>
  );
}

// ── 광고 배너 ────────────────────────────────────────

function useDark() {
  const [dark, setDark] = useState(() => window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false);
  useEffect(() => {
    const mq = window.matchMedia?.('(prefers-color-scheme: dark)');
    if (!mq) return;
    const fn = () => setDark(mq.matches);
    mq.addEventListener('change', fn);
    return () => mq.removeEventListener('change', fn);
  }, []);
  return dark;
}

export function BannerAd() {
  const ref = useRef<HTMLDivElement>(null);
  const dark = useDark();
  const [state, setState] = useState<'loading' | 'on' | 'off'>('loading');
  useEffect(() => {
    let cleanup: (() => void) | null = null;
    let alive = true;
    if (ref.current) {
      attachBannerAd(ref.current, dark ? 'dark' : 'light').then((c) => {
        if (!alive) return c?.();
        cleanup = c;
        setState(c ? 'on' : 'off');
      });
    }
    return () => {
      alive = false;
      cleanup?.();
    };
  }, [dark]);
  return (
    <div className="ad-slot">
      <div ref={ref} />
      {state === 'off' && import.meta.env.DEV && <div className="ad-dev">배너 광고 자리 (광고 그룹 ID 설정 시 노출)</div>}
    </div>
  );
}

export function Spinner() {
  return <div className="spinner" aria-label="불러오는 중" />;
}
