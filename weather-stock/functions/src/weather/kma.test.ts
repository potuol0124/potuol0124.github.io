import { describe, expect, it } from 'vitest';
import { parseRain } from './kma';

describe('기상청 강수량 문자열', () => {
  it.each([
    ['강수없음', 0],
    ['1mm 미만', 0.5],
    ['1.0mm', 1],
    ['12.5mm', 12.5],
    ['30.0~50.0mm', 40],
    ['50.0mm 이상', 50],
    ['3', 3],
  ])('%s → %d', (raw, mm) => expect(parseRain(raw)).toBe(mm));
});
