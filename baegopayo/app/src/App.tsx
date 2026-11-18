import { openURL } from '@apps-in-toss/web-framework';
import { Button, Chip, ChipItem, SegmentedControl, Top } from '@toss/tds-mobile';
import { Fragment, useCallback, useEffect, useRef, useState } from 'react';
import { BannerAd } from './components/BannerAd';
import { PlaceRow } from './components/PlaceRow';
import { maybeShowInterstitial, preloadInterstitial } from './lib/ads';
import { fetchNearby, isDemo } from './lib/api';
import { LocationDeniedError, getLocation } from './lib/location';
import {
  FOOD_STYLES,
  RADIUS_OPTIONS,
  type Radius,
  formatDistance,
  radiusLabel,
  walkMinutes,
} from './lib/styles';
import type { Coords, Place, SortKey, StyleId } from './lib/types';

const PREFS_KEY = 'baegopayo:prefs';
const SITE = 'https://potuol0124.github.io/baegopayo';
/** 결과 몇 개마다 배너 광고를 끼울지 */
const BANNER_EVERY = 6;

interface Prefs {
  radius: Radius;
  styles: StyleId[];
  sort: SortKey;
}

function loadPrefs(): Prefs {
  const fallback: Prefs = { radius: 1000, styles: [], sort: 'distance' };
  try {
    const raw = localStorage.getItem(PREFS_KEY);
    if (!raw) return fallback;
    const p = JSON.parse(raw) as Partial<Prefs>;
    return {
      radius: RADIUS_OPTIONS.includes(p.radius as Radius) ? (p.radius as Radius) : fallback.radius,
      styles: Array.isArray(p.styles)
        ? p.styles.filter((s): s is StyleId => FOOD_STYLES.some((f) => f.id === s))
        : [],
      sort: p.sort === 'rating' ? 'rating' : 'distance',
    };
  } catch {
    return fallback;
  }
}

function savePrefs(p: Prefs) {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(p));
  } catch {
    /* 저장 못 해도 동작에는 문제없어요 */
  }
}

type Status =
  | { kind: 'idle' }
  | { kind: 'locating' }
  | { kind: 'searching' }
  | { kind: 'done' }
  | { kind: 'denied' }
  | { kind: 'error'; message: string };

function sortPlaces(places: Place[], sort: SortKey): Place[] {
  const list = places.slice();
  if (sort === 'rating') {
    // 별점 × 리뷰 수 신뢰도: 리뷰가 적은 5.0보다 리뷰 많은 4.5가 위로 오게
    const score = (p: Place) =>
      p.rating == null ? -1 : p.rating - 1.5 / Math.sqrt((p.ratingCount ?? 0) + 1);
    list.sort((a, b) => score(b) - score(a) || a.distance - b.distance);
  } else {
    list.sort((a, b) => a.distance - b.distance);
  }
  return list;
}

export default function App() {
  const [prefs, setPrefs] = useState<Prefs>(loadPrefs);
  const [status, setStatus] = useState<Status>({ kind: 'idle' });
  const [places, setPlaces] = useState<Place[]>([]);
  const [ratingsEnabled, setRatingsEnabled] = useState(false);
  const [picked, setPicked] = useState<string | null>(null);
  const coordsRef = useRef<Coords | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => savePrefs(prefs), [prefs]);
  useEffect(() => preloadInterstitial(), []);

  const toggleStyle = (id: StyleId | 'all') => {
    setPrefs((p) => {
      if (id === 'all') return { ...p, styles: [] };
      const has = p.styles.includes(id);
      return { ...p, styles: has ? p.styles.filter((s) => s !== id) : [...p.styles, id] };
    });
  };

  const search = useCallback(
    async (refreshLocation: boolean) => {
      abortRef.current?.abort();
      const ac = new AbortController();
      abortRef.current = ac;
      setPicked(null);

      try {
        if (refreshLocation || !coordsRef.current) {
          setStatus({ kind: 'locating' });
          coordsRef.current = await getLocation();
        }
        setStatus({ kind: 'searching' });
        const [res] = await Promise.all([
          fetchNearby(
            { ...coordsRef.current, radius: prefs.radius, styles: prefs.styles, sort: prefs.sort },
            ac.signal,
          ),
          maybeShowInterstitial(),
        ]);
        if (ac.signal.aborted) return;
        setRatingsEnabled(res.ratingsEnabled);
        setPlaces(res.places);
        setStatus({ kind: 'done' });
      } catch (e) {
        if (ac.signal.aborted) return;
        if (e instanceof LocationDeniedError) setStatus({ kind: 'denied' });
        else setStatus({ kind: 'error', message: e instanceof Error ? e.message : '문제가 생겼어요' });
      }
    },
    [prefs.radius, prefs.styles, prefs.sort],
  );

  const open = (url: string) => {
    openURL(url).catch(() => window.open(url, '_blank', 'noopener'));
  };
  const openPlace = (p: Place) => open(p.url);

  const pickRandom = () => {
    if (places.length === 0) return;
    const candidates = places.length > 1 ? places.filter((p) => p.id !== picked) : places;
    const choice = candidates[Math.floor(Math.random() * candidates.length)];
    setPicked(choice.id);
    requestAnimationFrame(() =>
      document.getElementById(`place-${choice.id}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' }),
    );
  };

  const busy = status.kind === 'locating' || status.kind === 'searching';
  const sorted = sortPlaces(places, ratingsEnabled ? prefs.sort : 'distance');
  const pickedPlace = picked ? places.find((p) => p.id === picked) : undefined;
  const hasRatings = places.some((p) => p.rating != null);

  return (
    <div className="app">
      <Top
        title={<Top.TitleParagraph>근처 맛집 찾기</Top.TitleParagraph>}
        subtitleBottom={
          <Top.SubtitleParagraph>거리와 메뉴만 고르면 지금 갈 만한 곳을 찾아드려요</Top.SubtitleParagraph>
        }
      />

      <section className="section">
        <h2 className="section-title">얼마나 갈 수 있나요?</h2>
        <SegmentedControl
          value={String(prefs.radius)}
          onChange={(v) => setPrefs((p) => ({ ...p, radius: Number(v) as Radius }))}
          alignment="fixed"
        >
          {RADIUS_OPTIONS.map((r) => (
            <SegmentedControl.Item key={r} value={String(r)}>
              <span className="nowrap">{radiusLabel(r)}</span>
            </SegmentedControl.Item>
          ))}
        </SegmentedControl>
        <p className="hint">걸어서 약 {walkMinutes(prefs.radius)}분 거리까지</p>
      </section>

      <section className="section">
        <h2 className="section-title">뭐 먹을까요?</h2>
        <Chip wrap>
          <ChipItem selected={prefs.styles.length === 0} onClick={() => toggleStyle('all')}>
            전체
          </ChipItem>
          {FOOD_STYLES.map((s) => (
            <ChipItem key={s.id} selected={prefs.styles.includes(s.id)} onClick={() => toggleStyle(s.id)}>
              {`${s.emoji} ${s.label}`}
            </ChipItem>
          ))}
        </Chip>
      </section>

      <div className="cta">
        <Button display="full" size="xlarge" loading={busy} onClick={() => search(false)}>
          {status.kind === 'done' ? '이 조건으로 다시 찾기' : '근처 맛집 찾기'}
        </Button>
      </div>

      {isDemo && <p className="demo-note">데모 모드예요. 실제 가게가 아닌 예시 데이터를 보여줘요.</p>}

      {status.kind === 'locating' && <p className="state">현재 위치를 확인하고 있어요…</p>}

      {status.kind === 'denied' && (
        <div className="state">
          <p>근처 식당을 찾으려면 위치 권한이 필요해요.</p>
          <Button variant="weak" size="medium" onClick={() => search(true)}>
            위치 권한 허용하기
          </Button>
        </div>
      )}

      {status.kind === 'error' && (
        <div className="state">
          <p>{status.message}</p>
          <Button variant="weak" size="medium" onClick={() => search(true)}>
            다시 시도
          </Button>
        </div>
      )}

      {status.kind === 'done' && places.length === 0 && (
        <div className="state">
          <p>
            {radiusLabel(prefs.radius)} 안에 조건에 맞는 곳이 없어요.
            <br />
            거리를 늘리거나 메뉴를 바꿔보세요.
          </p>
        </div>
      )}

      {status.kind === 'done' && places.length > 0 && (
        <section className="results">
          <div className="results-head">
            <span className="results-count">{places.length}곳</span>
            {ratingsEnabled && (
              <SegmentedControl
                size="small"
                value={prefs.sort}
                onChange={(v) => setPrefs((p) => ({ ...p, sort: v as SortKey }))}
              >
                <SegmentedControl.Item value="distance">거리순</SegmentedControl.Item>
                <SegmentedControl.Item value="rating">별점순</SegmentedControl.Item>
              </SegmentedControl>
            )}
          </div>

          <div className="pick">
            <Button variant="weak" size="medium" display="full" onClick={pickRandom}>
              {pickedPlace ? '🎲 다른 데 골라줘' : '🎲 고민될 땐 아무거나 골라줘'}
            </Button>
            {pickedPlace && (
              <p className="pick-result">
                오늘은 <b>{pickedPlace.name}</b> 어때요? ({formatDistance(pickedPlace.distance)})
              </p>
            )}
          </div>

          <ul className="place-list">
            {sorted.map((p, i) => (
              <Fragment key={p.id}>
                <PlaceRow place={p} highlighted={p.id === picked} onOpen={openPlace} />
                {(i + 1) % BANNER_EVERY === 0 && i + 1 < sorted.length && (
                  <li className="ad-slot">
                    <BannerAd />
                  </li>
                )}
              </Fragment>
            ))}
          </ul>

          <p className="source-note">
            장소 정보: 카카오{hasRatings && ' · 별점: Google 지도'}
            <br />
            가게를 누르면 카카오맵에서 자세히 볼 수 있어요
          </p>
          <div className="ad-slot bottom">
            <BannerAd />
          </div>
        </section>
      )}

      <footer className="footer">
        <button type="button" onClick={() => open(`${SITE}/privacy.html`)}>
          개인정보처리방침
        </button>
        <span aria-hidden>·</span>
        <button type="button" onClick={() => open(`${SITE}/terms.html`)}>
          이용약관
        </button>
      </footer>
    </div>
  );
}
