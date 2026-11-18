import { useMemo, useState } from 'react';
import { ECONOMY } from '@shared/config';
import { METRICS, METRIC_BY_ID, formatValue } from '@shared/metrics';
import { REGION_BY_ID } from '@shared/regions';
import { STOCKS } from '@shared/stocks';
import { Icon, StockRow, TopBar } from '../components/ui';
import { num } from '../lib/format';
import { useNow, usePrices, useStore } from '../lib/store';

export function Search() {
  const { market } = useStore();
  const now = useNow(1000);
  const priceOf = usePrices(now);
  const [q, setQ] = useState('');
  const results = useMemo(() => {
    const k = q.replace(/\s/g, '');
    if (!k) return [];
    return STOCKS.filter((s) => {
      const r = REGION_BY_ID[s.regionId];
      const m = METRIC_BY_ID[s.metricId];
      return (s.name + r.name + m.name + s.code).includes(k);
    }).slice(0, 40);
  }, [q]);
  return (
    <div className="page">
      <TopBar title="종목 검색" />
      <label className="search">
        {Icon.search}
        <input placeholder="지역, 지표, 종목코드 (예: 부산 강수량)" value={q} onChange={(e) => setQ(e.target.value)} autoFocus />
      </label>
      {q && results.length === 0 && <div className="empty">찾는 종목이 없어요</div>}
      <ul className="list">
        {results.map((s) => (
          <StockRow key={s.id} id={s.id} price={priceOf(s.id)} extra={`${formatValue(METRIC_BY_ID[s.metricId], market.stocks[s.id]?.value)} · ${s.code}`} />
        ))}
      </ul>
      {!q && <div className="empty">17개 시·도 × 6개 날씨 지표, 모두 {STOCKS.length}개 종목이 있어요</div>}
    </div>
  );
}

export function Rules() {
  return (
    <div className="page">
      <TopBar title="게임 규칙" />
      <div className="faq">
        <h4>날씨증권은 어떤 게임인가요?</h4>
        <p>
          전국 17개 시·도의 기온, 미세먼지, 초미세먼지, 강수량, 습도, 풍속이 각각 하나의 종목이에요. 실제 관측값이 오르면 주가도 오르고, 내리면 주가도 내려요. 실제 돈이 아닌 게임 화폐 {ECONOMY.currencyName}로
          거래해요.
        </p>
        <h4>주가는 어떻게 정해지나요?</h4>
        <p>
          매시 정각 관측값이 50분쯤 반영되면서 주가가 그 값에 맞춰지고, 다음 1시간 동안은 기상청 초단기예보를 향해 조금씩 움직여요. 예보가 빗나가면 다음 관측 때 가격이 확 바뀌어요. 미세먼지는 수치 예보가 없어서 다음 관측까지
          가격이 그대로예요.
        </p>
        <ul style={{ color: 'var(--text-2)', fontSize: 14, paddingLeft: 18, margin: '8px 0 0' }}>
          {METRICS.map((m) => (
            <li key={m.id}>
              {m.emoji} {m.name}: {formatValue(m, m.baseValue)}일 때 {num(m.basePrice)}날로
            </li>
          ))}
        </ul>
        <h4>배당은 언제, 얼마나 받나요?</h4>
        <p>
          매일 00시에 지난 24시간 동안 평균으로 들고 있던 주식 평가금액의 {(ECONOMY.dividendRate * 100).toFixed(1)}%를 받아요. 23시 59분에 사서 00시 1분에 팔면 1분만 들고 있던 것으로 쳐요.
        </p>
        <h4>수수료가 있나요?</h4>
        <p>구매·판매할 때마다 거래 금액의 {(ECONOMY.feeRate * 100).toFixed(1)}%를 수수료로 내요. 24시간 언제든 거래할 수 있어요.</p>
        <h4>가격 지정 주문(지정가)은 뭔가요?</h4>
        <p>
          원하는 가격을 정해 두면 그 가격 이하(구매) 또는 이상(판매)이 될 때 자동으로 체결돼요. 걸어둔 주문은 그날 00시에 만료되고, 한 번에 {ECONOMY.maxOpenOrders}개까지 걸 수 있어요.
        </p>
        <h4>토스포인트로 바꿀 수 있나요?</h4>
        <p>
          {num(ECONOMY.coinsPerPoint)}날로를 1포인트로 바꿀 수 있고, 하루 최대 {ECONOMY.dailyPointLimit}포인트까지예요. 바꾼 날로는 다시 돌려받을 수 없어요.
        </p>
        <h4>돈을 다 잃었어요</h4>
        <p>
          총자산이 {num(ECONOMY.bailoutThreshold)}날로보다 적으면 혜택 탭에서 하루 한 번 광고를 보고 구제금 {num(ECONOMY.bailoutAmount)}날로를 받을 수 있어요.
        </p>
        <h4>랭킹은 어떻게 매기나요?</h4>
        <p>주간 수익률(매주 월요일 00시 초기화)과 총자산 두 가지로 매시간 집계해요. 구제금과 포인트 환전은 수익률 계산에서 빼요.</p>
      </div>
    </div>
  );
}
