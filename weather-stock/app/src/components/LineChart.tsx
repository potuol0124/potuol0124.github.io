import { useEffect, useMemo, useRef, useState } from 'react';
import type { PricePoint } from '@shared/types';
import { num } from '../lib/format';

interface Props {
  points: PricePoint[];
  /** 툴팁 시각 표시 */
  timeLabel: (t: number) => string;
  /** 툴팁 수치 표시 */
  valueLabel?: (v: number) => string;
  /** 등락 기준선 가격 */
  base?: number;
  loading?: boolean;
  onScrub?: (p: PricePoint | null) => void;
}

const H = 220;
const PAD_T = 30;
const PAD_B = 22;

export function LineChart({ points, timeLabel, valueLabel, base, loading, onScrub }: Props) {
  const wrap = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(360);
  const [hover, setHover] = useState<number | null>(null);

  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setW(el.clientWidth || 360));
    ro.observe(el);
    setW(el.clientWidth || 360);
    return () => ro.disconnect();
  }, []);

  const geo = useMemo(() => {
    if (points.length < 2) return null;
    const t0 = points[0].t;
    const t1 = points[points.length - 1].t;
    let lo = Infinity;
    let hi = -Infinity;
    let loI = 0;
    let hiI = 0;
    points.forEach((p, i) => {
      if (p.price < lo) [lo, loI] = [p.price, i];
      if (p.price > hi) [hi, hiI] = [p.price, i];
    });
    const refLo = Math.min(lo, base ?? lo);
    const refHi = Math.max(hi, base ?? hi);
    const span = Math.max(1, refHi - refLo);
    const padY = span * 0.08;
    const yMin = refLo - padY;
    const yMax = refHi + padY;
    const x = (t: number) => ((t - t0) / Math.max(1, t1 - t0)) * (w - 2) + 1;
    const y = (p: number) => PAD_T + (1 - (p - yMin) / (yMax - yMin)) * (H - PAD_T - PAD_B);
    const d = points.map((p, i) => `${i ? 'L' : 'M'}${x(p.t).toFixed(1)},${y(p.price).toFixed(1)}`).join('');
    const area = `${d}L${x(t1).toFixed(1)},${H}L${x(t0).toFixed(1)},${H}Z`;
    return { x, y, d, area, lo, hi, loI, hiI };
  }, [points, w, base]);

  const first = points[0]?.price ?? 0;
  const last = points[points.length - 1]?.price ?? 0;
  const color = last > (base ?? first) ? 'var(--up)' : last < (base ?? first) ? 'var(--down)' : 'var(--text-3)';

  const pick = (clientX: number) => {
    if (!geo || !wrap.current) return;
    const rect = wrap.current.getBoundingClientRect();
    const px = clientX - rect.left;
    let best = 0;
    let bestD = Infinity;
    points.forEach((p, i) => {
      const dd = Math.abs(geo.x(p.t) - px);
      if (dd < bestD) [bestD, best] = [dd, i];
    });
    setHover(best);
    onScrub?.(points[best]);
  };
  const end = () => {
    setHover(null);
    onScrub?.(null);
  };

  const hp = hover != null ? points[hover] : null;
  const label = (i: number, text: string) => {
    if (!geo) return null;
    const px = geo.x(points[i].t);
    const anchor = px < 50 ? 'start' : px > w - 50 ? 'end' : 'middle';
    return { px, anchor: anchor as 'start' | 'end' | 'middle', text };
  };
  const hiL = geo && label(geo.hiI, `최고 ${num(geo.hi)}`);
  const loL = geo && label(geo.loI, `최저 ${num(geo.lo)}`);

  return (
    <div
      className="chart-wrap"
      ref={wrap}
      onPointerDown={(e) => pick(e.clientX)}
      onPointerMove={(e) => (e.pointerType === 'mouse' || e.buttons ? pick(e.clientX) : undefined)}
      onPointerUp={(e) => e.pointerType !== 'mouse' && end()}
      onPointerLeave={end}
      onPointerCancel={end}
    >
      {geo && (
        <svg viewBox={`0 0 ${w} ${H}`} preserveAspectRatio="none" aria-label="가격 차트" role="img">
          <defs>
            <linearGradient id="chart-fill" x1="0" x2="0" y1="0" y2="1">
              <stop offset="0" stopColor={color} stopOpacity="0.18" />
              <stop offset="1" stopColor={color} stopOpacity="0" />
            </linearGradient>
          </defs>
          {base != null && (
            <line x1="0" x2={w} y1={geo.y(base)} y2={geo.y(base)} stroke="var(--text-4)" strokeDasharray="2 4" strokeWidth="1" />
          )}
          <path d={geo.area} fill="url(#chart-fill)" />
          <path d={geo.d} fill="none" stroke={color} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
          {hiL && hp == null && (
            <text x={hiL.px} y={geo.y(geo.hi) - 8} textAnchor={hiL.anchor} fontSize="11" fill="var(--text-3)" fontWeight="600">
              {hiL.text}
            </text>
          )}
          {loL && hp == null && geo.loI !== geo.hiI && (
            <text x={loL.px} y={geo.y(geo.lo) + 16} textAnchor={loL.anchor} fontSize="11" fill="var(--text-3)" fontWeight="600">
              {loL.text}
            </text>
          )}
          {hp == null && (
            <circle cx={geo.x(points[points.length - 1].t)} cy={geo.y(last)} r="4" fill={color} stroke="var(--bg)" strokeWidth="2" />
          )}
          {hp && (
            <g>
              <line x1={geo.x(hp.t)} x2={geo.x(hp.t)} y1={PAD_T - 6} y2={H} stroke="var(--text-4)" strokeWidth="1" />
              <circle cx={geo.x(hp.t)} cy={geo.y(hp.price)} r="5" fill={color} stroke="var(--bg)" strokeWidth="2" />
            </g>
          )}
        </svg>
      )}
      {hp && geo && (
        <div className="chart-tip" style={{ left: Math.min(w - 70, Math.max(70, geo.x(hp.t))) }}>
          <span className="t">{timeLabel(hp.t)}</span>
          {num(hp.price)}날로
          {hp.value != null && valueLabel ? ` · ${valueLabel(hp.value)}` : ''}
        </div>
      )}
      {(loading || points.length < 2) && <div className="chart-loading">{loading ? '차트를 불러오는 중…' : '아직 데이터가 부족해요'}</div>}
    </div>
  );
}
