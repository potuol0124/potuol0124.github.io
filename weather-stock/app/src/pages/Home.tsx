import { useMemo, useState } from 'react';
import { ECONOMY } from '@shared/config';
import { settleDividend, totalAssets } from '@shared/engine';
import { changeRate } from '@shared/market';
import { METRICS, METRIC_BY_ID, formatValue, type MetricId } from '@shared/metrics';
import { REGIONS } from '@shared/regions';
import { STOCKS, STOCK_BY_ID } from '@shared/stocks';
import { kstNextMidnight } from '@shared/time';
import { BannerAd, Icon, StockRow } from '../components/ui';
import { countdown, dir, hhmm, num, pct, signed } from '../lib/format';
import { useRouter } from '../lib/router';
import { useNow, usePrices, useStore } from '../lib/store';

type Sort = 'rate' | 'price' | 'name';
const SORT_LABEL: Record<Sort, string> = { rate: '등락률순', price: '가격순', name: '이름순' };

export function Home() {
  const { market, account } = useStore();
  const { push, setTab } = useRouter();
  const now = useNow(1000);
  const priceOf = usePrices(now);
  const [metric, setMetric] = useState<MetricId | 'all'>('all');
  const [region, setRegion] = useState<string>('all');
  const [sort, setSort] = useState<Sort>('rate');
  const [mover, setMover] = useState<'up' | 'down'>('up');

  const holdings = Object.values(account.holdings);
  const assets = totalAssets(account.user, holdings, priceOf);
  const dayBase = account.user.cash + account.user.reservedCash + holdings.reduce((s, h) => s + h.shares * (market.stocks[h.stockId]?.dayOpen ?? 0), 0);
  const dayPnl = assets - dayBase;
  const midnight = kstNextMidnight(now);
  const estDividend = holdings.reduce((s, h) => s + settleDividend(h, midnight, priceOf(h.stockId)).dividend, 0);

  const movers = useMemo(() => {
    const arr = STOCKS.map((s) => ({ id: s.id, r: changeRate(priceOf(s.id), market.stocks[s.id]?.dayOpen ?? 0) }));
    arr.sort((a, b) => (mover === 'up' ? b.r - a.r : a.r - b.r));
    return arr.slice(0, 5);
    // 1분마다만 다시 계산해서 순위가 너무 자주 흔들리지 않게 해요
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [market, mover, Math.floor(now / 60_000)]);

  const list = useMemo(() => {
    let arr = STOCKS.filter((s) => (metric === 'all' || s.metricId === metric) && (region === 'all' || s.regionId === region));
    const rate = (id: string) => changeRate(priceOf(id), market.stocks[id]?.dayOpen ?? 0);
    if (sort === 'rate') arr = [...arr].sort((a, b) => rate(b.id) - rate(a.id));
    if (sort === 'price') arr = [...arr].sort((a, b) => priceOf(b.id) - priceOf(a.id));
    if (sort === 'name') arr = [...arr].sort((a, b) => a.name.localeCompare(b.name, 'ko'));
    return arr;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [metric, region, sort, market, Math.floor(now / 30_000)]);

  const watch = account.user.watchlist.filter((id) => STOCK_BY_ID[id]);

  return (
    <div className="page">
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark" aria-hidden>
            ☁
          </span>
          날씨증권
        </div>
        <div style={{ flex: 1 }} />
        <button className="iconbtn" aria-label="종목 검색" onClick={() => push({ name: 'search' })}>
          {Icon.search}
        </button>
      </header>

      <button className="asset-hero" style={{ display: 'block', width: '100%', textAlign: 'left' }} onClick={() => setTab('account')}>
        <div className="label">
          내 총자산 <span className="muted">{Icon.chev}</span>
        </div>
        <div className="value tnum">
          {num(assets)}
          <span className="unit">날로</span>
        </div>
        <div className={`change tnum ${dir(dayPnl)}`}>
          오늘 {signed(dayPnl)} ({pct(dayBase ? dayPnl / dayBase : 0)})
        </div>
        <div className="pill-row">
          <div className="pill-stat">
            <div className="k">다음 배당까지</div>
            <div className="v tnum">{countdown(midnight - now)}</div>
          </div>
          <div className="pill-stat">
            <div className="k">예상 배당</div>
            <div className="v tnum">{num(estDividend)}날로</div>
          </div>
        </div>
      </button>

      <div className="divider" />

      {watch.length > 0 && (
        <>
          <div className="section-title">관심 종목</div>
          <ul className="list">
            {watch.map((id) => (
              <StockRow key={id} id={id} price={priceOf(id)} />
            ))}
          </ul>
          <div className="divider" />
        </>
      )}

      <div className="section-title">
        오늘의 날씨 급{mover === 'up' ? '등' : '락'}
        <span className="more">{hhmm(market.obsHour)} 관측 기준</span>
      </div>
      <div className="seg" style={{ marginBottom: 4 }}>
        <button className={mover === 'up' ? 'on' : ''} onClick={() => setMover('up')}>
          상승
        </button>
        <button className={mover === 'down' ? 'on' : ''} onClick={() => setMover('down')}>
          하락
        </button>
      </div>
      <ul className="list">
        {movers.map((m, i) => (
          <StockRow key={m.id} id={m.id} price={priceOf(m.id)} rank={i + 1} />
        ))}
      </ul>

      <BannerAd />
      <div className="divider" />

      <div className="section-title">전체 종목</div>
      <div className="chips" role="tablist" aria-label="지표">
        <button className={`chip ${metric === 'all' ? 'on' : ''}`} onClick={() => setMetric('all')}>
          전체
        </button>
        {METRICS.map((m) => (
          <button key={m.id} className={`chip ${metric === m.id ? 'on' : ''}`} onClick={() => setMetric(m.id)}>
            {m.emoji} {m.name}
          </button>
        ))}
      </div>
      <div className="chips" style={{ paddingTop: 0 }} aria-label="지역">
        <button className={`chip ${region === 'all' ? 'on' : ''}`} onClick={() => setRegion('all')}>
          전국
        </button>
        {REGIONS.map((r) => (
          <button key={r.id} className={`chip ${region === r.id ? 'on' : ''}`} onClick={() => setRegion(r.id)}>
            {r.name}
          </button>
        ))}
      </div>
      <div className="sortbar">
        <span>{list.length}개 종목</span>
        <button onClick={() => setSort(sort === 'rate' ? 'price' : sort === 'price' ? 'name' : 'rate')}>
          {Icon.sort} {SORT_LABEL[sort]}
        </button>
      </div>
      <ul className="list">
        {list.map((s) => (
          <StockRow
            key={s.id}
            id={s.id}
            price={priceOf(s.id)}
            extra={`${formatValue(METRIC_BY_ID[s.metricId], market.stocks[s.id]?.value)} · ${s.code}`}
          />
        ))}
      </ul>
      <p className="notice">
        시세는 매시 정각 관측값이 {hhmm(market.updatedAt).slice(3)}분쯤 반영되고, 그 사이에는 다음 시각 예보를 향해 조금씩 움직여요. 모든 거래는 실제 돈이 아닌 {ECONOMY.currencyName}로 해요.
      </p>
    </div>
  );
}
