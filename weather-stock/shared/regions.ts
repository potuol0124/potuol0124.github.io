/**
 * 광역시·도 17곳.
 * nx, ny: 기상청 단기예보 격자 좌표 (시·도청 소재지 기준)
 * sido: 에어코리아 시도별 실시간 측정정보 API의 sidoName
 * code: 종목코드 앞 2자리
 */
export interface Region {
  id: string;
  name: string;
  short: string;
  nx: number;
  ny: number;
  sido: string;
  code: string;
}

export const REGIONS: Region[] = [
  { id: 'seoul', name: '서울', short: '서울', nx: 60, ny: 127, sido: '서울', code: '11' },
  { id: 'busan', name: '부산', short: '부산', nx: 98, ny: 76, sido: '부산', code: '21' },
  { id: 'daegu', name: '대구', short: '대구', nx: 89, ny: 90, sido: '대구', code: '22' },
  { id: 'incheon', name: '인천', short: '인천', nx: 55, ny: 124, sido: '인천', code: '23' },
  { id: 'gwangju', name: '광주', short: '광주', nx: 58, ny: 74, sido: '광주', code: '24' },
  { id: 'daejeon', name: '대전', short: '대전', nx: 67, ny: 100, sido: '대전', code: '25' },
  { id: 'ulsan', name: '울산', short: '울산', nx: 102, ny: 84, sido: '울산', code: '26' },
  { id: 'sejong', name: '세종', short: '세종', nx: 66, ny: 103, sido: '세종', code: '29' },
  { id: 'gyeonggi', name: '경기', short: '경기', nx: 60, ny: 121, sido: '경기', code: '31' },
  { id: 'gangwon', name: '강원', short: '강원', nx: 73, ny: 134, sido: '강원', code: '32' },
  { id: 'chungbuk', name: '충북', short: '충북', nx: 69, ny: 106, sido: '충북', code: '33' },
  { id: 'chungnam', name: '충남', short: '충남', nx: 68, ny: 100, sido: '충남', code: '34' },
  { id: 'jeonbuk', name: '전북', short: '전북', nx: 63, ny: 89, sido: '전북', code: '35' },
  { id: 'jeonnam', name: '전남', short: '전남', nx: 50, ny: 67, sido: '전남', code: '36' },
  { id: 'gyeongbuk', name: '경북', short: '경북', nx: 91, ny: 106, sido: '경북', code: '37' },
  { id: 'gyeongnam', name: '경남', short: '경남', nx: 90, ny: 77, sido: '경남', code: '38' },
  { id: 'jeju', name: '제주', short: '제주', nx: 52, ny: 38, sido: '제주', code: '39' },
];

export const REGION_BY_ID: Record<string, Region> = Object.fromEntries(REGIONS.map((r) => [r.id, r]));
