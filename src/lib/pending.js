// The open editor registers a "save everything now" function here, so actions outside the
// editor (Switch user) can wait for unsaved work before they end the session.
let flushFn = null;

export function setPendingFlush(fn) {
  flushFn = fn;
  return () => {
    if (flushFn === fn) flushFn = null;
  };
}

// Resolves true when nothing is left unsaved (or no editor is open), false otherwise.
export async function flushPending({ timeoutMs = 5000 } = {}) {
  if (!flushFn) return true;
  let timer;
  try {
    const saved = await Promise.race([
      Promise.resolve().then(flushFn),
      new Promise((resolve) => {
        timer = setTimeout(() => resolve(false), timeoutMs);
      }),
    ]);
    return saved !== false;
  } catch {
    return false; // the editor shows its own save error
  } finally {
    clearTimeout(timer);
  }
}

export const UNSAVED_PROMPT = 'Some of your latest changes are not saved. Leave anyway?';
