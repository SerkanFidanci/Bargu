import { isVaultOpen, vault } from '../storage/vault';

/**
 * "Açtığını {ad} görür." (docs/ADR/0035 Ek 1, the PM's condition): whoever opens someone's story is
 * told once that its sender sees it was opened. Kept on this phone only.
 */
const KEY = 'messages:view-notice:v1';

/** The first story of someone else opened here: true once (and from then on told), then false. */
export function firstViewNotice(): boolean {
  if (!isVaultOpen()) return false;
  const store = vault();
  if (store.get(KEY) === '1') return false;
  store.set(KEY, '1');
  return true;
}
