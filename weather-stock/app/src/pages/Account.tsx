import { ECONOMY } from '@shared/config';
import { holdingsValue, settleDividend, totalAssets } from '@shared/engine';
import { STOCK_BY_ID } from '@shared/stocks';
import { kstNextMidnight } from '@shared/time';
import type { LedgerEntry } from '@shared/types';
import { Icon, StockRow, TopBar } from '../components/ui';
import { countdown, dir, mdhm, num, pct, signed } from '../lib/format';
import { useRouter } from '../lib/router';
import { useNow, usePrices, useStore, useToast } from '../lib/store';

export function Account() {
  const { account } = useStore();
  const { push } = useRouter();
  const now = useNow(1000);
  const priceOf = usePrices(now);
  const holdings = Object.values(account.holdings).filter((h) => h.shares > 0);
  const stockValue = holdingsValue(holdings, priceOf);
  const cost = holdings.reduce((s, h) => s + h.avgPrice * h.shares, 0);
  const assets = totalAssets(account.user, holdings, priceOf);
  const midnight = kstNextMidnight(now);
  const estDividend = holdings.reduce((s, h) => s + settleDividend(h, midnight, priceOf(h.stockId)).dividend, 0);
  const pending = account.orders.filter((o) => o.status === 'pending');

  return (
    <div className="page">
      <header className="topbar">
        <div className="title" style={{ fontSize: 20, fontWeight: 800 }}>
          내 계좌
        </div>
      </header>
      <div className="asset-hero">
        <div className="label">총자산</div>
        <div className="value tnum">
          {num(assets)}
          <span className="unit">날로</span>
        </div>
        <div className={`change tnum ${dir(stockValue - cost)}`}>
          투자 손익 {signed(stockValue - cost)} ({pct(cost ? stockValue / cost - 1 : 0)})
        </div>
        <div className="pill-row">
          <div className="pill-stat">
            <div className="k">주문 가능</div>
            <div className="v tnum">{num(account.user.cash)}</div>
          </div>
          <div className="pill-stat">
            <div className="k">주식</div>
            <div className="v tnum">{num(stockValue)}</div>
          </div>
          {account.user.reservedCash > 0 && (
            <div className="pill-stat">
              <div className="k">주문 대기</div>
              <div className="v tnum">{num(account.user.reservedCash)}</div>
            </div>
          )}
        </div>
      </div>

      <div className="card" style={{ marginBottom: 8 }}>
        <div className="card-title">00시 배당</div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
          <span style={{ fontSize: 24, fontWeight: 800 }} className="tnum">
            {num(estDividend)}날로
          </span>
          <span className="muted tnum">{countdown(midnight - now)} 남음</span>
        </div>
        <p className="muted" style={{ fontSize: 13, margin: '8px 0 0' }}>
          지난 24시간 동안 평균으로 들고 있던 주식 평가금액의 {(ECONOMY.dividendRate * 100).toFixed(1)}%를 매일 00시에 드려요. 오래 들고 있을수록 많이 받아요.
          {account.user.lastDividend && ` 지난 배당: ${num(account.user.lastDividend.amount)}날로`}
        </p>
      </div>

      <div className="section-title">
        보유 종목 <span className="more">{holdings.length}개</span>
      </div>
      {holdings.length === 0 ? (
        <div className="empty">
          <div className="big">🌤️</div>
          아직 가진 주식이 없어요.
          <br />
          홈에서 날씨 종목을 골라 보세요.
        </div>
      ) : (
        <ul className="list">
          {holdings
            .sort((a, b) => priceOf(b.stockId) * b.shares - priceOf(a.stockId) * a.shares)
            .map((h) => {
              const p = priceOf(h.stockId);
              const r = h.avgPrice ? p / h.avgPrice - 1 : 0;
              return (
                <StockRow
                  key={h.stockId}
                  id={h.stockId}
                  price={p}
                  extra={
                    <>
                      {num(h.shares)}주 · {num(p * h.shares)}날로 <span className={dir(r)}>{pct(r)}</span>
                    </>
                  }
                />
              );
            })}
        </ul>
      )}

      <div className="divider" style={{ marginTop: 8 }} />
      <button className="link-row" onClick={() => push({ name: 'orders' })}>
        <span>
          주문 내역 {pending.length > 0 && <span className="badge red">대기 {pending.length}</span>}
        </span>
        <span className="chev">{Icon.chev}</span>
      </button>
      <button className="link-row" onClick={() => push({ name: 'ledger' })}>
        <span>거래·배당 내역</span>
        <span className="chev">{Icon.chev}</span>
      </button>
    </div>
  );
}

const LEDGER_ICON: Record<LedgerEntry['type'], string> = {
  signup: '🎁',
  buy: '🔴',
  sell: '🔵',
  dividend: '💰',
  bailout: '🛟',
  exchange: '🪙',
  refund: '↩️',
};

export function Ledger() {
  const { account } = useStore();
  return (
    <div className="page">
      <TopBar title="거래·배당 내역" />
      {account.ledger.length === 0 && <div className="empty">내역이 없어요</div>}
      <ul className="list">
        {account.ledger.map((e) => (
          <li key={e.id} className="row" style={{ cursor: 'default' }}>
            <span className="icon">{LEDGER_ICON[e.type]}</span>
            <span className="main">
              <div className="name">{e.memo}</div>
              <div className="desc">
                {mdhm(e.at)}
                {e.price != null && ` · ${num(e.price)}날로`}
                {e.fee ? ` · 수수료 ${num(e.fee)}` : ''}
                {e.profit != null && (
                  <span className={dir(e.profit)}>
                    {' '}
                    · 손익 {signed(e.profit)}
                  </span>
                )}
              </div>
            </span>
            <span className={`end tnum bold ${e.amount > 0 ? 'up' : ''}`}>{signed(e.amount)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

const STATUS_LABEL = { pending: '대기', filled: '체결', cancelled: '취소', expired: '만료' } as const;

export function Orders() {
  const { account, backend } = useStore();
  const toast = useToast();
  return (
    <div className="page">
      <TopBar title="주문 내역" />
      {account.orders.length === 0 && <div className="empty">주문 내역이 없어요</div>}
      <ul className="list">
        {account.orders.map((o) => (
          <li key={o.id} className="row" style={{ cursor: 'default' }}>
            <span className="main">
              <div className="name">
                <span className={o.side === 'buy' ? 'up' : 'down'}>{o.side === 'buy' ? '구매' : '판매'}</span> {STOCK_BY_ID[o.stockId]?.name} {num(o.qty)}주
              </div>
              <div className="desc">
                {mdhm(o.createdAt)} · {o.type === 'market' ? '시장가' : `지정가 ${num(o.limitPrice ?? 0)}`}
                {o.status === 'filled' && ` · ${num(o.price ?? 0)}날로 체결`}
              </div>
            </span>
            {o.status === 'pending' ? (
              <button
                className="btn sm gray"
                onClick={async () => {
                  try {
                    await backend.cancelOrder(o.id);
                    toast.show('주문을 취소했어요');
                  } catch (e) {
                    toast.show((e as Error).message);
                  }
                }}
              >
                취소
              </button>
            ) : (
              <span className={`badge ${o.status === 'filled' ? 'blue' : ''}`}>{STATUS_LABEL[o.status]}</span>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
