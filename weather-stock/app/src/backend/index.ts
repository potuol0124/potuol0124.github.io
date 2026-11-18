import type { Backend } from './types';

export type { Account, Backend, OrderRequest } from './types';

/** VITE_BACKEND=firebase 이면 Firebase, 아니면 목업 */
export async function createBackend(): Promise<Backend> {
  if (import.meta.env.VITE_BACKEND === 'firebase') {
    const { FirebaseBackend } = await import('./firebase');
    return new FirebaseBackend();
  }
  const { MockBackend } = await import('./mock');
  return new MockBackend();
}
