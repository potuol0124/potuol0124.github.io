import { useEffect, useMemo, useState } from 'react';
import { ECONOMY } from '@shared/config';
import { settleDividend } from '@shared/engine';
import { changeRate } from '@shared/market';
import { METRIC_BY_ID, formatValue, valueToPrice } from '@shared/metrics';
import { REGION_BY_ID } from '@shared/regions';
import { STOCK_BY_ID } from '@shared/stocks';
import { DAY, HOUR, kstNextMidnight } from '@shared/time';
import type { PricePoint } from '@shared/types';
import { LineChart } from '../components/LineChart';
import { Icon, TopBar } from '../components/ui';
import { countdown, dir, hhmm, hourLabel, md, mdhm, num, pct, signed } from '../lib/format';
import { useRouter } from '../lib/router';
import { useNow, usePrices, useStore, useToast } from '../lib/store';
import { haptic } from '../platform/toss';

type Range = '1d' | '1w' | '1m' | '3m';
const RANGES: { id: Range; label: string; ms: number; step: number }[] = [
  { id: '1d', label: '1일', ms: DAY, step: 1 },
  { id: '1w', label: '1주', ms: 7 * DAY, step: 1 },
  { id: '1m', label: '1달', ms: 30 * DAY, step: 3 },
  { id: '3m', label: '3달', ms: 90 * DAY, step: 6 },
];

const GRADE_CLASS: Record<string, string> = { 좋음: 'g1', 보통: 'g2', 나쁨: 'g3', 매우나쁨: 'g4' };

export function StockDetail({ id }: { id: string }) {
  const { market, account, backend } = useStore();
  const { push } = useRouter();
  const toast = useToast();
  const now = useNow(1000);
  const priceOf = usePrices(now);
  const s = STOCK_BY_ID[id];
  const m = METRIC_BY_ID[s.metricId];
  const region = REGION_BY_ID[s.regionId];
  const st = market.stocks[id];
  const price = priceOf(id);
  const rate = st ? changeRate(price, st.dayOpen) : 0;
  const [range, setRange] = useState<Range>('1d');
  const [hist, setHist] = useState<PricePoint[]>([]);
  const [loading, setLoading] = useState(true);
  const [scrub, setScrub] = useState<PricePoint | null>(null);

  const r = RANGES.find((x) => x.id === range)!;
  useEffect(() => {
    let alive = true;
    setLoading(true);
    const to = Date.now();
    backend
      .getHistory(id, to - r.ms, to)
      .then((pts) => {
        if (!alive) return;
        setHist(r.step > 1 ? pts.filter((p) => Math.round(p.t / HOUR) % r.step === 0) : pts);
      })
      .catch(() => alive && setHist([]))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
    // 관측이 새로 반영되면 다시 불러와요
  }, [backend, id, range, market.obsHour]);

  const points = useMemo(() => {
    const live = { t: now, price, value: st?.value ?? undefined };
    return hist.length ? [...hist.filter((p) => p.t < now), live] : [];
  }, [hist, now, price, st?.value]);

  const holding = account.holdings[id];
  const watched = account.user.watchlist.includes(id);
  const pending = account.orders.filter((o) => o.stockId === id && o.status === 'pending');
  const nextUpdate = st ? st.targetAt : now;
  const midnight = kstNextMidnight(now);
  const estDividend = holding ? settleDividend(holding, midnight, price).dividend : 0;

  const display = scrub ?? { t: now, price, value: st?.value ?? undefined };
  const displayRate = scrub ? changeRate(scrub.price, points[0]?.price ?? scrub.price) : rate;

  const toggleWatch = async () => {
    haptic('tickWeak');
    try {
      await backend.toggleWatch(id);
      toast.show(watched ? '관심 종목에서 뺐어요' : '관심 종목에 추가했어요');
    } catch (e) {
      toast.show((e as Error).message);
    }
  };

  const forecastHint = useMemo(() => {
    if (!st || !st.forecast.length) return null;
    const first = st.forecast[0];
    const last = st.forecast[st.forecast.length - 1];
    const p1 = valueToPrice(m, last.v);
    const diff = changeRate(p1, price);
    const word = Math.abs(diff) < 0.005 ? '비슷할' : diff > 0 ? '오를' : '내릴';
    return { first, last, diff, word };
  }, [st, m, price]);

  const dust = market.dust[s.regionId];
  const isDust = s.metricId === 'pm10' || s.metricId === 'pm25';

  return (
    <div className="page with-cta">
      <TopBar title={s.name} />
      <section className="quote">
        <div className="stock-name">
          {m.emoji} {s.name} <span className="code">{s.code}</span>
        </div>
        <div className="price tnum">{num(display.price)}날로</div>
        <div className={`chg tnum ${dir(displayRate)}`}>
          {scrub ? `${mdhm(scrub.t)} · ` : '00시보다 '}
          {signed(display.price - (scrub ? (points[0]?.price ?? display.price) : (st?.dayOpen ?? price)))} ({pct(displayRate)})
        </div>
        <div className="obs">
          <span className="live-dot" />
          {region.name} {m.name} {formatValue(m, display.value)}
          <span className="muted">· {hhmm(scrub?.t ?? st?.obsAt ?? now)} 관측</span>
        </div>
      </section>

      <LineChart
        points={points}
        loading={loading}
        base={range === '1d' ? st?.dayOpen : points[0]?.price}
        timeLabel={(t) => (range === '1d' ? hhmm(t) : mdhm(t))}
        valueLabel={(v) => formatValue(m, v)}
        onScrub={setScrub}
      />
      <div className="chart-range" role="tablist">
        {RANGES.map((x) => (
          <button key={x.id} className={range === x.id ? 'on' : ''} onClick={() => setRange(x.id)}>
            {x.label}
          </button>
        ))}
      </div>

      <div className="divider" style={{ marginTop: 12 }} />

      {holding && holding.shares > 0 && (
        <>
          <div className="section-title">내 주식</div>
          <div className="mine">
            <div className="top">
              <span className="sub">평가금액</span>
              <span className={`tnum bold ${dir(price - holding.avgPrice)}`}>
                {signed((price - holding.avgPrice) * holding.shares)} ({pct(holding.avgPrice ? price / holding.avgPrice - 1 : 0)})
              </span>
            </div>
            <div className="val tnum">{num(price * holding.shares)}날로</div>
            <div className="grid">
              <span className="k">보유 수량</span>
              <span className="v tnum">{num(holding.shares)}주</span>
              <span className="k">평균 단가</span>
              <span className="v tnum">{num(holding.avgPrice)}날로</span>
              <span className="k">오늘 00시 예상 배당</span>
              <span className="v tnum">{num(estDividend)}날로</span>
              {holding.reserved > 0 && (
                <>
                  <span className="k">매도 대기</span>
                  <span className="v tnum">{num(holding.reserved)}주</span>
                </>
              )}
            </div>
          </div>
        </>
      )}

      {pending.length > 0 && (
        <>
          <div className="section-title">미체결 주문</div>
          <ul className="list">
            {pending.map((o) => (
              <li key={o.id} className="row" style={{ cursor: 'default' }}>
                <span className="main">
                  <div className="name">
                    <span className={o.side === 'buy' ? 'up' : 'down'}>{o.side === 'buy' ? '매수' : '매도'}</span> {num(o.qty)}주
                  </div>
                  <div className="desc">
                    {num(o.limitPrice ?? 0)}날로 {o.side === 'buy' ? '이하' : '이상'}이면 체결 · 00시 만료
                  </div>
                </span>
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
              </li>
            ))}
          </ul>
        </>
      )}

      <div className="section-title">
        날씨 예보 힌트 <span className="badge blue">예보</span>
      </div>
      {isDust ? (
        <>
          <div className="kv" style={{ gridTemplateColumns: '1fr' }}>
            <div>
              <span className="k">오늘 {region.name} 미세먼지 예보</span>
              <span className={`grade ${GRADE_CLASS[dust?.today ?? ''] ?? ''}`}>{dust?.today ?? '-'}</span>
            </div>
            <div>
              <span className="k">내일 {region.name} 미세먼지 예보</span>
              <span className={`grade ${GRADE_CLASS[dust?.tomorrow ?? ''] ?? ''}`}>{dust?.tomorrow ?? '-'}</span>
            </div>
          </div>
          {market.dustSummary && <div className="hint">{market.dustSummary}</div>}
        </>
      ) : st && st.forecast.length ? (
        <>
          <div className="forecast">
            {st.forecast.map((f) => {
              const fp = valueToPrice(m, f.v);
              const fr = changeRate(fp, price);
              return (
                <div className="fc" key={f.t}>
                  <div className="h">{hourLabel(f.t)}</div>
                  <div className="v tnum">{formatValue(m, f.v)}</div>
                  <div className={`p tnum ${dir(fr)}`}>{pct(fr, 1)}</div>
                </div>
              );
            })}
          </div>
          {forecastHint && (
            <div className="hint">
              기상청 예보대로라면 {hourLabel(forecastHint.last.t)}에는 지금보다 <b>{pct(forecastHint.diff, 1)}</b> {forecastHint.word} 거예요. 예보는 틀릴 수 있어요.
            </div>
          )}
        </>
      ) : (
        <div className="empty">예보가 아직 없어요</div>
      )}

      <div className="section-title">시세 정보</div>
      <div className="kv">
        <div>
          <span className="k">00시</span>
          <span className="v tnum">{num(st?.dayOpen ?? 0)}</span>
        </div>
        <div>
          <span className="k">기준 수치</span>
          <span className="v tnum">{formatValue(m, m.baseValue)}</span>
        </div>
        <div>
          <span className="k">고가</span>
          <span className="v tnum up">{num(Math.max(st?.high ?? 0, price))}</span>
        </div>
        <div>
          <span className="k">저가</span>
          <span className="v tnum down">{num(Math.min(st?.low ?? price, price))}</span>
        </div>
        <div>
          <span className="k">다음 관측</span>
          <span className="v tnum">{countdown(nextUpdate - now).slice(3)}</span>
        </div>
        <div>
          <span className="k">배당률</span>
          <span className="v tnum">일 {(ECONOMY.dividendRate * 100).toFixed(1)}%</span>
        </div>
      </div>

      <div className="section-title">종목 설명</div>
      <div className="desc-box">
        {m.description}
        <br />
        {region.name} 지역 대표 관측값을 써요. {md(now)} 기준 정보예요.
      </div>

      <div className="cta">
        <button className={`btn heart ${watched ? 'on' : ''}`} onClick={toggleWatch} aria-label={watched ? '관심 종목 해제' : '관심 종목 추가'}>
          {Icon.heart(watched)}
        </button>
        <button className="btn sell" onClick={() => push({ name: 'order', id, side: 'sell' })} disabled={!holding || holding.shares - holding.reserved <= 0}>
          판매하기
        </button>
        <button className="btn buy" onClick={() => push({ name: 'order', id, side: 'buy' })}>
          구매하기
        </button>
      </div>
    </div>
  );
}
