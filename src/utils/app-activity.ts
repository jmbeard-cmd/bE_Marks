// src/utils/app-activity.ts

export type AppActivityReason =
  | 'media-viewer'
  | 'video-playing'
  | 'camera'
  | 'audio-recording'
  | 'screen-transition'
  | 'manual';

const activeReasons = new Set<AppActivityReason>();
const listeners = new Set<() => void>();

function notify() {
  listeners.forEach((listener) => {
    try {
      listener();
    } catch (error) {
      console.warn('[app-activity] listener failed:', error);
    }
  });
}

export function setAppActivity(reason: AppActivityReason, active: boolean) {
  const hadReason = activeReasons.has(reason);

  if (active) {
    activeReasons.add(reason);
  } else {
    activeReasons.delete(reason);
  }

  const changed = active ? !hadReason : hadReason;
  if (changed) {
    console.log('[app-activity]', active ? 'busy:' : 'clear:', reason);
    notify();
  }
}

export function isAppBusy() {
  return activeReasons.size > 0;
}

export function getAppActivityReasons() {
  return Array.from(activeReasons);
}

export function subscribeToAppActivity(listener: () => void) {
  listeners.add(listener);

  return () => {
    listeners.delete(listener);
  };
}