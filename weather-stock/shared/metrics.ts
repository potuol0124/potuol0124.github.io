/**
 * 날씨 지표 = 종목 업종.
 *
 * 주가 = basePrice × (수치 + offset) / (기준수치 + offset)  ← "수치 연동 지수"
 * offset은 영하 기온이나 0mm 강수량에서도 가격이 0 이하로 떨어지지 않게 해 줘요.
 * 강수량만 로그 스케일을 써요(0mm가 대부분이고 폭우 때 값이 크게 튀어서).
 */
export type MetricId = 'temp' | 'pm10' | 'pm25' | 'rain' | 'humid' | 'wind';

export interface Metric {
  id: MetricId;
  name: string;
  /** 종목명 뒤에 붙는 짧은 이름 */
  label: string;
  unit: string;
  /** 표시 소수점 자릿수 */
  digits: number;
  basePrice: number;
  /** 이 수치일 때 basePrice가 돼요 */
  baseValue: number;
  offset: number;
  /** 종목코드 뒤 4자리 */
  code: string;
  /** 설명 (종목 상세에 노출) */
  description: string;
  /** 차트·뱃지 강조색 */
  emoji: string;
  /** 가격 산식 종류 */
  scale: 'linear' | 'log';
  /** 값의 하한(관측 오류 방지) */
  min: number;
  max: number;
}

export const METRICS: Metric[] = [
  {
    id: 'temp',
    name: '기온',
    label: '기온',
    unit: '℃',
    digits: 1,
    basePrice: 20_000,
    baseValue: 15,
    offset: 30,
    code: '0010',
    description: '1시간마다 관측되는 기온이에요. 15℃일 때 20,000날로이고, 1℃ 오를 때마다 약 2.2%씩 올라요.',
    emoji: '🌡️',
    scale: 'linear',
    min: -29,
    max: 50,
  },
  {
    id: 'pm10',
    name: '미세먼지',
    label: '미세먼지',
    unit: '㎍/㎥',
    digits: 0,
    basePrice: 8_000,
    baseValue: 40,
    offset: 30,
    code: '0020',
    description: '시·도 측정소 평균 미세먼지(PM10) 농도예요. 40㎍/㎥일 때 8,000날로예요. 황사가 오면 크게 올라요.',
    emoji: '🌫️',
    scale: 'linear',
    min: 0,
    max: 1000,
  },
  {
    id: 'pm25',
    name: '초미세먼지',
    label: '초미세먼지',
    unit: '㎍/㎥',
    digits: 0,
    basePrice: 8_000,
    baseValue: 20,
    offset: 15,
    code: '0030',
    description: '시·도 측정소 평균 초미세먼지(PM2.5) 농도예요. 20㎍/㎥일 때 8,000날로예요.',
    emoji: '😷',
    scale: 'linear',
    min: 0,
    max: 500,
  },
  {
    id: 'rain',
    name: '강수량',
    label: '강수량',
    unit: 'mm',
    digits: 1,
    basePrice: 3_000,
    baseValue: 0,
    offset: 1,
    code: '0040',
    description: '최근 1시간 강수량이에요. 비가 안 오면 3,000날로로 잔잔하다가, 비가 오면 크게 뛰어요. 10mm면 약 2.4배예요.',
    emoji: '🌧️',
    scale: 'log',
    min: 0,
    max: 300,
  },
  {
    id: 'humid',
    name: '습도',
    label: '습도',
    unit: '%',
    digits: 0,
    basePrice: 10_000,
    baseValue: 60,
    offset: 40,
    code: '0050',
    description: '상대습도예요. 60%일 때 10,000날로예요. 비 오는 날 강수량과 같이 오르는 경향이 있어요.',
    emoji: '💧',
    scale: 'linear',
    min: 0,
    max: 100,
  },
  {
    id: 'wind',
    name: '풍속',
    label: '풍속',
    unit: 'm/s',
    digits: 1,
    basePrice: 5_000,
    baseValue: 3,
    offset: 4,
    code: '0060',
    description: '평균 풍속이에요. 3m/s일 때 5,000날로예요. 태풍이 오면 몇 배로 뛰어요.',
    emoji: '🌬️',
    scale: 'linear',
    min: 0,
    max: 70,
  },
];

export const METRIC_BY_ID = Object.fromEntries(METRICS.map((m) => [m.id, m])) as Record<MetricId, Metric>;

/** 날씨 수치 → 주가 (정수 날로, 최소 1) */
export function valueToPrice(metric: Metric, value: number): number {
  const v = Math.min(metric.max, Math.max(metric.min, value));
  let ratio: number;
  if (metric.scale === 'log') {
    // 0mm → 1배, 1mm → 1.42배, 10mm → 2.44배, 50mm → 3.36배
    ratio = 1 + 0.6 * Math.log1p(v / metric.offset);
  } else {
    ratio = (v + metric.offset) / (metric.baseValue + metric.offset);
  }
  return Math.max(1, Math.round(metric.basePrice * ratio));
}

export function formatValue(metric: Metric, value: number | null | undefined): string {
  if (value == null || Number.isNaN(value)) return '-';
  return `${value.toFixed(metric.digits)}${metric.unit}`;
}
