import { useState } from 'react';
import { ECONOMY } from '@shared/config';
import { exchangeRemaining, totalAssets } from '@shared/engine';
import { kstDayKey } from '@shared/time';
import { Icon, Sheet } from '../components/ui';
import { num } from '../lib/format';
import { useRouter } from '../lib/router';
import { useNow, usePrices, useStore, useToast } from '../lib/store';
import { grantTossPoints, haptic, openExternal, showRewardedAd } from '../platform/toss';

const POLICY_BASE = 'https://potuol0124.github.io/weather-stock';

export function Benefit() {
  const { account, backend } = useStore();
  const { push } = useRouter();
  const toast = useToast();
  const now = useNow(5000);
  const priceOf = usePrices(now);
  const user = account.user;
  const remaining = exchangeRemaining(user, now);
  const usedToday = ECONOMY.dailyPointLimit - remaining;
  const maxByCash = Math.floor(user.cash / ECONOMY.coinsPerPoint);
  const maxPoints = Math.min(remaining, maxByCash);
  const [points, setPoints] = useState(0);
  const [sheet, setSheet] = useState<'exchange' | 'nickname' | 'reset' | null>(null);
  const [busy, setBusy] = useState(false);
  const [nick, setNick] = useState(user.nickname);

  const assets = totalAssets(user, Object.values(account.holdings), priceOf);
  const bailoutEligible = assets < ECONOMY.bailoutThreshold && user.lastBailoutDay !== kstDayKey(now);

  const exchange = async () => {
    setBusy(true);
    let exchangeId = '';
    try {
      ({ exchangeId } = await backend.requestExchange(points));
      const key = await grantTossPoints(points);
      await backend.confirmExchange(exchangeId, key);
      haptic('confetti');
      toast.show(`토스포인트 ${points}P를 받았어요`);
      setPoints(0);
      setSheet(null);
    } catch (e) {
      const msg = (e as Error).message;
      if (exchangeId) await backend.cancelExchange(exchangeId, msg).catch(() => {});
      haptic('error');
      toast.show(exchangeId ? `${msg} 날로는 돌려드렸어요.` : msg);
      setSheet(null);
    } finally {
      setBusy(false);
    }
  };

  const bailout = async () => {
    setBusy(true);
    try {
      const watched = await showRewardedAd();
      if (!watched) {
        toast.show('광고를 끝까지 봐야 받을 수 있어요');
        return;
      }
      await backend.claimBailout();
      haptic('success');
      toast.show(`구제금 ${num(ECONOMY.bailoutAmount)}날로를 받았어요`);
    } catch (e) {
      toast.show((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const saveNick = async () => {
    setBusy(true);
    try {
      await backend.setNickname(nick);
      toast.show('닉네임을 바꿨어요');
      setSheet(null);
    } catch (e) {
      toast.show((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const openUrl = (path: string) => openExternal(`${POLICY_BASE}/${path}`);

  return (
    <div className="page">
      <header className="topbar">
        <div className="title" style={{ fontSize: 20, fontWeight: 800 }}>
          혜택
        </div>
      </header>

      <div className="benefit-hero">
        <div className="k">토스포인트로 바꿀 수 있는 날로</div>
        <div className="v tnum">{num(user.cash)}날로</div>
        <div className="s">
          {num(ECONOMY.coinsPerPoint)}날로 = 1포인트 · 하루 최대 {ECONOMY.dailyPointLimit}포인트
        </div>
      </div>

      <div className="card white" style={{ paddingTop: 16 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 14 }}>
          <span className="sub">오늘 바꾼 포인트</span>
          <span className="tnum bold">
            {usedToday} / {ECONOMY.dailyPointLimit}P
          </span>
        </div>
        <div className="meter">
          <i style={{ width: `${(usedToday / ECONOMY.dailyPointLimit) * 100}%` }} />
        </div>
        <button className="btn block" style={{ marginTop: 16 }} disabled={maxPoints < ECONOMY.minExchangePoints} onClick={() => {
          setPoints(maxPoints);
          setSheet('exchange');
        }}>
          {remaining === 0 ? '오늘은 다 바꿨어요' : maxByCash < 1 ? '바꿀 날로가 부족해요' : '토스포인트로 바꾸기'}
        </button>
        <p className="muted" style={{ fontSize: 12, margin: '10px 0 0' }}>
          한도는 매일 00시에 초기화돼요. 주식을 팔아야 현금(주문 가능 금액)이 생겨요.
        </p>
      </div>

      <div className="divider" style={{ marginTop: 20 }} />

      <div className="section-title">구제금</div>
      <div className="card">
        <div style={{ fontWeight: 700, fontSize: 17 }}>🛟 {num(ECONOMY.bailoutAmount)}날로 받기</div>
        <p className="sub" style={{ fontSize: 14, margin: '6px 0 14px' }}>
          총자산이 {num(ECONOMY.bailoutThreshold)}날로보다 적으면 하루 한 번 광고를 보고 받을 수 있어요. 지금 총자산 {num(assets)}날로.
        </p>
        <button className="btn block weak" disabled={!bailoutEligible || busy} onClick={bailout}>
          {user.lastBailoutDay === kstDayKey(now) ? '오늘은 이미 받았어요' : bailoutEligible ? '광고 보고 받기' : '아직 받을 수 없어요'}
        </button>
      </div>

      <div className="divider" style={{ marginTop: 20 }} />

      <button className="link-row" onClick={() => {
        setNick(user.nickname);
        setSheet('nickname');
      }}>
        <span>
          닉네임 <span className="muted">{user.nickname}</span>
        </span>
        <span className="chev">{Icon.chev}</span>
      </button>
      <button className="link-row" onClick={() => push({ name: 'rules' })}>
        <span>게임 규칙</span>
        <span className="chev">{Icon.chev}</span>
      </button>
      <button className="link-row" onClick={() => openUrl('terms.html')}>
        <span>이용약관</span>
        <span className="chev">{Icon.chev}</span>
      </button>
      <button className="link-row" onClick={() => openUrl('privacy.html')}>
        <span>개인정보처리방침</span>
        <span className="chev">{Icon.chev}</span>
      </button>
      {backend.reset && (
        <button className="link-row" onClick={() => setSheet('reset')}>
          <span className="muted">목업 데이터 초기화</span>
          <span className="chev">{Icon.chev}</span>
        </button>
      )}
      <p className="notice" style={{ marginTop: 12 }}>
        날씨증권은 날씨 데이터를 이용한 모의 투자 게임이에요. 실제 주식·금융상품이 아니고, {ECONOMY.currencyName}는 현금으로 바꿀 수 없어요. 날씨 데이터 출처: 기상청, 한국환경공단(에어코리아).
      </p>

      {sheet === 'exchange' && (
        <Sheet onClose={() => !busy && setSheet(null)}>
          <h3>토스포인트로 바꾸기</h3>
          <p>
            오늘 {remaining}포인트까지 바꿀 수 있어요. 바꾼 포인트는 토스 앱에 바로 들어가요.
          </p>
          <div className="field" style={{ margin: '0 0 8px' }}>
            <div className="lbl">
              <span>바꿀 포인트</span>
              <span>최대 {maxPoints}P</span>
            </div>
            <div className="ctrl">
              <button className="stepper" onClick={() => setPoints((p) => Math.max(ECONOMY.minExchangePoints, p - 1))}>
                −
              </button>
              <input
                inputMode="numeric"
                value={points}
                onChange={(e) => setPoints(Math.min(maxPoints, Number(e.target.value.replace(/\D/g, '')) || 0))}
                aria-label="바꿀 포인트"
              />
              <span className="suffix">P</span>
              <button className="stepper" onClick={() => setPoints((p) => Math.min(maxPoints, p + 1))}>
                +
              </button>
            </div>
          </div>
          <div className="summary" style={{ margin: 0 }}>
            <div>
              <span className="k">필요한 날로</span>
              <span className="tnum bold">{num(points * ECONOMY.coinsPerPoint)}날로</span>
            </div>
          </div>
          <div className="actions">
            <button className="btn gray" onClick={() => setSheet(null)} disabled={busy}>
              닫기
            </button>
            <button className="btn" onClick={exchange} disabled={busy || points < ECONOMY.minExchangePoints || points > maxPoints}>
              {busy ? '바꾸는 중…' : `${points}P 받기`}
            </button>
          </div>
        </Sheet>
      )}

      {sheet === 'nickname' && (
        <Sheet onClose={() => !busy && setSheet(null)}>
          <h3>닉네임 바꾸기</h3>
          <p>랭킹에 보이는 이름이에요. 한글·영문·숫자 {ECONOMY.nicknameMin}~{ECONOMY.nicknameMax}자.</p>
          <div className="field" style={{ margin: 0 }}>
            <div className="ctrl">
              <input style={{ textAlign: 'left', fontSize: 20 }} value={nick} maxLength={ECONOMY.nicknameMax} onChange={(e) => setNick(e.target.value)} autoFocus />
            </div>
          </div>
          <div className="actions">
            <button className="btn gray" onClick={() => setSheet(null)}>
              닫기
            </button>
            <button className="btn" onClick={saveNick} disabled={busy || nick.trim() === user.nickname}>
              저장
            </button>
          </div>
        </Sheet>
      )}

      {sheet === 'reset' && (
        <Sheet onClose={() => setSheet(null)}>
          <h3>목업 데이터를 초기화할까요?</h3>
          <p>이 브라우저에 저장된 자산·거래 내역이 모두 지워지고 시작 자금부터 다시 시작해요.</p>
          <div className="actions">
            <button className="btn gray" onClick={() => setSheet(null)}>
              닫기
            </button>
            <button
              className="btn buy"
              onClick={async () => {
                await backend.reset?.();
                setSheet(null);
                toast.show('초기화했어요');
              }}
            >
              초기화
            </button>
          </div>
        </Sheet>
      )}
    </div>
  );
}
