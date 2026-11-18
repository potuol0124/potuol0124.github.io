import { Accuracy, Device } from '@apps-in-toss/web-framework';
import type { Coords } from './types';

export class LocationDeniedError extends Error {
  constructor() {
    super('위치 권한이 필요해요');
    this.name = 'LocationDeniedError';
  }
}

function isPermissionError(e: unknown): boolean {
  return e instanceof Error && /permission/i.test(`${e.name} ${e.message}`);
}

/** 토스 앱 밖(일반 브라우저)에서 열렸을 때의 대체 경로 */
function browserLocation(): Promise<Coords> {
  return new Promise((resolve, reject) => {
    if (!('geolocation' in navigator)) {
      reject(new Error('이 기기에서는 위치를 가져올 수 없어요'));
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ lat: p.coords.latitude, lng: p.coords.longitude }),
      (err) => reject(err.code === err.PERMISSION_DENIED ? new LocationDeniedError() : err),
      { enableHighAccuracy: false, timeout: 10_000, maximumAge: 60_000 },
    );
  });
}

/**
 * 현재 위치를 한 번 가져와요.
 * 권한이 없으면 토스 권한 다이얼로그를 띄우고, 끝내 거부하면 LocationDeniedError 를 던져요.
 */
export async function getLocation(): Promise<Coords> {
  try {
    const status = await Device.getLocation.getPermission();
    if (status !== 'allowed') {
      const result = await Device.getLocation.openPermissionDialog();
      if (result !== 'allowed') throw new LocationDeniedError();
    }
    const loc = await Device.getLocation({ accuracy: Accuracy.Balanced });
    return { lat: loc.coords.latitude, lng: loc.coords.longitude };
  } catch (e) {
    if (e instanceof LocationDeniedError) throw e;
    if (isPermissionError(e)) throw new LocationDeniedError();
    // 토스 브릿지가 없는 환경이면 브라우저 위치 API로 대신해요.
    return browserLocation();
  }
}
