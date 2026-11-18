import { useEffect, useState } from 'react';
import { totalAssets, weeklyReturn } from '@shared/engine';
import type { Ranking as RankingDoc, RankingEntry } from '@shared/types';
import { Spinner } from '../components/ui';
import { compact, dir, hhmm, num, pct } from '../lib/format';
import { useNow, usePrices, useStore } from '../lib/store';

const MEDAL = ['🥇', '🥈', '🥉'];

export function Ranking() {
  const { backend, account } = useStore();
  const now = useNow(5000);
  const priceOf = usePrices(now);
  const [tab, setTab] = useState<'weekly' | 'total'>('weekly');
  const [data, setData] = useState<RankingDoc>();

  useEffect(() => {
    let alive = true;
    const load = () => backend.getRanking().then((r) => alive && setData(r)).catch(() => {});
    load();
    const id = setInterval(load, 60_000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [backend]);

  const myAssets = totalAssets(account.user, Object.values(account.holdings), priceOf);
  const myWeekly = weeklyReturn(account.user, myAssets);
  const list = data ? data[tab] : [];
  const myIdx = list.findIndex((e) => e.uid === account.user.uid);
  const score = (e: RankingEntry) =>
    tab === 'weekly' ? <span className={dir(e.weeklyReturn)}>{pct(e.weeklyReturn, 1)}</span> : <span>{compact(e.totalAssets)}</span>;

  return (
    <div className="page">
      <header className="topbar">
        <div className="title" style={{ fontSize: 20, fontWeight: 800 }}>
          랭킹
        </div>
      </header>
      <div className="seg">
        <button className={tab === 'weekly' ? 'on' : ''} onClick={() => setTab('weekly')}>
          주간 수익률
        </button>
        <button className={tab === 'total' ? 'on' : ''} onClick={() => setTab('total')}>
          총자산
        </button>
      </div>

      <div className="me-row row" style={{ cursor: 'default' }}>
        <span className="rank">{myIdx >= 0 ? myIdx + 1 : '-'}</span>
        <span className="main">
          <div className="name">{account.user.nickname} (나)</div>
          <div className="desc">{tab === 'weekly' ? '월요일 00시부터 이번 주 수익률' : '현금 + 주식 평가금액'}</div>
        </span>
        <span className="end tnum bold">
          {tab === 'weekly' ? <span className={dir(myWeekly)}>{pct(myWeekly, 1)}</span> : `${num(myAssets)}날로`}
        </span>
      </div>

      {!data ? (
        <div className="splash" style={{ minHeight: 200 }}>
          <Spinner />
        </div>
      ) : list.length === 0 ? (
        <div className="empty">아직 랭킹이 집계되지 않았어요</div>
      ) : (
        <>
          <div className="podium">
            {[1, 0, 2].map((i) =>
              list[i] ? (
                <div key={i} className={`p ${i === 0 ? 'first' : ''}`}>
                  <div className="medal">{MEDAL[i]}</div>
                  <div className="nn">{list[i].nickname}</div>
                  <div className="sc tnum">{score(list[i])}</div>
                </div>
              ) : (
                <div key={i} />
              ),
            )}
          </div>
          <ul className="list" style={{ marginTop: 8 }}>
            {list.slice(3, 100).map((e, i) => (
              <li key={e.uid} className="row" style={{ cursor: 'default' }}>
                <span className="rank" style={{ color: 'var(--text-3)' }}>
                  {i + 4}
                </span>
                <span className="main">
                  <div className="name">
                    {e.nickname}
                    {e.uid === account.user.uid && ' (나)'}
                  </div>
                </span>
                <span className="end tnum bold">{score(e)}</span>
              </li>
            ))}
          </ul>
          <p className="notice">
            랭킹은 매시간 집계돼요{data.updatedAt ? ` · 마지막 집계 ${hhmm(data.updatedAt)}` : ''}. 주간 수익률은 구제금과 포인트 환전을 빼고 계산해요.
          </p>
        </>
      )}
    </div>
  );
}
