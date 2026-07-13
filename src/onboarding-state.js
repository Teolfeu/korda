export const ONBOARDING_STATE_VERSION = 1;
export const ONBOARDING_STORAGE_KEY = `korda:onboarding:v${ONBOARDING_STATE_VERSION}`;

function storageOrDefault(storage) {
  if (storage !== undefined) return storage;
  try { return globalThis.localStorage; } catch { return null; }
}

export function shouldShowOnboarding(storage) {
  const target = storageOrDefault(storage);
  if (!target || typeof target.getItem !== "function") return true;
  try {
    const raw = target.getItem(ONBOARDING_STORAGE_KEY);
    if (typeof raw !== "string" || !raw) return true;
    const value = JSON.parse(raw);
    return !value
      || typeof value !== "object"
      || Array.isArray(value)
      || value.version !== ONBOARDING_STATE_VERSION
      || value.seen !== true;
  } catch {
    return true;
  }
}

export function markOnboardingSeen(storage) {
  const target = storageOrDefault(storage);
  if (!target || typeof target.setItem !== "function") return false;
  try {
    target.setItem(ONBOARDING_STORAGE_KEY, JSON.stringify({
      version: ONBOARDING_STATE_VERSION,
      seen: true,
    }));
    return true;
  } catch {
    return false;
  }
}

export function resetOnboarding(storage) {
  const target = storageOrDefault(storage);
  if (!target || typeof target.removeItem !== "function") return false;
  try {
    target.removeItem(ONBOARDING_STORAGE_KEY);
    return true;
  } catch {
    return false;
  }
}
