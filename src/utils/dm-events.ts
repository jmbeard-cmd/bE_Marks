type DMListener = (threadId?: string) => void;

const listeners = new Set<DMListener>();

export function subscribeToDMEvents(listener: DMListener): () => void {
  listeners.add(listener);

  return () => {
    listeners.delete(listener);
  };
}

export function emitDMChanged(threadId?: string): void {
  listeners.forEach(listener => {
    try {
      listener(threadId);
    } catch (e) {
      console.warn('[DM Events] listener failed:', e);
    }
  });
}