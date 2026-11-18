import { useEffect, useState } from 'react';
import { ECONOMY } from '@shared/config';
import { buyCost, feeFor, maxBuyQty } from '@shared/engine';
import { changeRate } from '@shared/market';
import { STOCK_BY_ID } from '@shared/stocks';
import type { OrderSide, OrderType } from '@shared/types';
import { Sheet, TopBar } from '../components/ui';
import { dir, num, pct } from '../lib/format';
import { useRouter } from '../lib/router';
import { useNow, usePrices, useStore, useToast } from '../lib/store';
import { haptic } from '../platform/toss';

const parseInt0 = (s: string) => {
  const n = Number(s.replace(/[^0-9]/g, ''));
  return Number.isFinite(n) ? n : 0;
};

export function Order({ id, side: initialSide }: { id: string; side: OrderSide }) {
  const { account, backend, market } = useStore();
  const { back, replace } = useRouter();
  const toast = useToast();
  const now = useNow(1000);
  const priceOf = usePrices(now);
  const s = STOCK_BY_ID[id];
  const price = priceOf(id);
  const rate = changeRate(price, market.stocks[id]?.dayOpen ?? price);
  const [side, setSide] = useState<OrderSide>(initialSide);
  const [type, setType] = useState<OrderType>('market');
  const [limitStr, setLimitStr] = useState(String(price));
  const [qtyStr, setQtyStr] = useState('');
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (type === 'limit') setLimitStr(String(price));
    // 지정가로 바꾸는 순간의 현재가로 채워요
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [type]);

  const holding = account.holdings[id];
  const sellable = holding ? holding.shares - holding.reserved : 0;
  const unitPrice = type === 'market' ? price : parseInt0(limitStr);
  const qty = parseInt0(qtyStr);
  const amount = unitPrice * qty;
  const fee = feeFor(amount);
  const cash = account.user.cash;
  const maxQty = side === 'buy' ? maxBuyQty(cash, unitPrice) : sellable;
  const total = side === 'buy' ? buyCost(unitPrice, qty) : amount - fee;
  const tick = Math.max(1, Math.round(price * 0.001));

  let error = '';
  if (qty > 0 && side === 'buy' && total > cash) error = '주문 가능 금액이 부족해요.';
  if (qty > 0 && side === 'sell' && qty > sellable) error = '판매 가능 수량이 부족해요.';
  if (qty > ECONOMY.maxOrderQty) error = `한 번에 ${num(ECONOMY.maxOrderQty)}주까지 주문할 수 있어요.`;
  if (type === 'limit' && unitPrice <= 0) error = '가격을 입력해 주세요.';
  const canSubmit = qty > 0 && !error && !busy;

  const setRatio = (r: number) => {
    haptic('tickWeak');
    setQtyStr(String(Math.max(0, Math.floor(maxQty * r))));
  };

  const submit = async () => {
    setBusy(true);
    try {
      const o = await backend.placeOrder({ stockId: id, side, type, qty, limitPrice: type === 'limit' ? unitPrice : undefined });
      haptic('success');
      if (o.status === 'filled') {
        toast.show(`${s.name} ${num(o.qty)}주를 ${num(o.price ?? 0)}날로에 ${side === 'buy' ? '샀어요' : '팔았어요'}`);
      } else {
        toast.show(`${num(unitPrice)}날로에 ${side === 'buy' ? '구매' : '판매'} 주문을 걸어뒀어요`);
      }
      setConfirm(false);
      back();
    } catch (e) {
      haptic('error');
      toast.show((e as Error).message);
      setConfirm(false);
    } finally {
      setBusy(false);
    }
  };

  const verb = side === 'buy' ? '구매' : '판매';

  return (
    <div className="page with-cta">
      <TopBar title={`${s.name} ${verb}하기`} />
      <div className="underline-tabs" style={{ marginBottom: 16 }}>
        <button
          className={side === 'buy' ? 'on up' : ''}
          style={side === 'buy' ? { borderColor: 'var(--up)', color: 'var(--up)' } : undefined}
          onClick={() => {
            setSide('buy');
            replace({ name: 'order', id, side: 'buy' });
          }}
        >
          구매
        </button>
        <button
          className={side === 'sell' ? 'on' : ''}
          style={side === 'sell' ? { borderColor: 'var(--down)', color: 'var(--down)' } : undefined}
          onClick={() => {
            setSide('sell');
            replace({ name: 'order', id, side: 'sell' });
          }}
        >
          판매
        </button>
      </div>

      <div className="order-head">
        <div className="nm">{s.name}</div>
        <div className={`pr tnum ${dir(rate)}`}>
          현재가 {num(price)}날로 ({pct(rate)})
        </div>
      </div>

      <div className="seg" style={{ marginBottom: 12 }}>
        <button className={type === 'market' ? 'on' : ''} onClick={() => setType('market')}>
          지금 가격(시장가)
        </button>
        <button className={type === 'limit' ? 'on' : ''} onClick={() => setType('limit')}>
          가격 지정(지정가)
        </button>
      </div>

      {type === 'limit' && (
        <div className="field">
          <div className="lbl">
            <span>{side === 'buy' ? '이 가격 이하가 되면 구매' : '이 가격 이상이 되면 판매'}</span>
            <span>00시까지 유효</span>
          </div>
          <div className="ctrl">
            <button className="stepper" onClick={() => setLimitStr(String(Math.max(1, unitPrice - tick)))} aria-label="가격 내리기">
              −
            </button>
            <input inputMode="numeric" value={num(unitPrice)} onChange={(e) => setLimitStr(String(parseInt0(e.target.value)))} aria-label="지정 가격" />
            <span className="suffix">날로</span>
            <button className="stepper" onClick={() => setLimitStr(String(unitPrice + tick))} aria-label="가격 올리기">
              +
            </button>
          </div>
        </div>
      )}

      <div className="field">
        <div className="lbl">
          <span>수량</span>
          <span>
            {side === 'buy' ? '최대' : '판매 가능'} {num(maxQty)}주
          </span>
        </div>
        <div className="ctrl">
          <input
            inputMode="numeric"
            placeholder="몇 주"
            value={qtyStr ? num(qty) : ''}
            onChange={(e) => setQtyStr(e.target.value ? String(parseInt0(e.target.value)) : '')}
            aria-label="수량"
            autoFocus
          />
          <span className="suffix">주</span>
        </div>
        <div className="quick">
          {[0.1, 0.25, 0.5, 1].map((r) => (
            <button key={r} onClick={() => setRatio(r)}>
              {r === 1 ? '최대' : `${r * 100}%`}
            </button>
          ))}
        </div>
      </div>

      <div className="summary">
        <div>
          <span className="k">{side === 'buy' ? '주문 가능 금액' : '보유 현금'}</span>
          <span className="tnum">{num(cash)}날로</span>
        </div>
        <div>
          <span className="k">주문 금액</span>
          <span className="tnum">{num(amount)}날로</span>
        </div>
        <div>
          <span className="k">수수료 ({(ECONOMY.feeRate * 100).toFixed(1)}%)</span>
          <span className="tnum">{num(fee)}날로</span>
        </div>
        <div className="total">
          <span>{side === 'buy' ? '총 필요 금액' : '받을 금액'}</span>
          <span className="tnum">{num(Math.max(0, total))}날로</span>
        </div>
      </div>
      {error && <div className="warn">{error}</div>}
      {type === 'market' && <p className="notice">지금 가격으로 바로 체결돼요. 주문하는 순간 가격이 조금 달라질 수 있어요.</p>}

      <div className="cta">
        <button className={`btn ${side === 'buy' ? 'buy' : 'sell'}`} disabled={!canSubmit} onClick={() => setConfirm(true)}>
          {qty > 0 ? `${num(qty)}주 ${verb}하기` : `${verb}할 수량을 입력해 주세요`}
        </button>
      </div>

      {confirm && (
        <Sheet onClose={() => !busy && setConfirm(false)}>
          <h3>
            {s.name} {num(qty)}주를 {verb}할까요?
          </h3>
          <p>
            {type === 'market' ? `지금 가격 약 ${num(unitPrice)}날로` : `${num(unitPrice)}날로 ${side === 'buy' ? '이하' : '이상'}일 때`} · 수수료 {num(fee)}날로
            <br />
            {side === 'buy' ? '총' : '받을 금액'} {num(Math.max(0, total))}날로
          </p>
          <div className="actions">
            <button className="btn gray" onClick={() => setConfirm(false)} disabled={busy}>
              닫기
            </button>
            <button className={`btn ${side === 'buy' ? 'buy' : 'sell'}`} onClick={submit} disabled={busy}>
              {busy ? '주문 중…' : `${verb}하기`}
            </button>
          </div>
        </Sheet>
      )}
    </div>
  );
}
