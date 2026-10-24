type ScrollTarget = { style: { overflow: string } };
const locks = new WeakMap<ScrollTarget, { count: number; original: string }>();

/** Nested dialogs share one lock, regardless of their unmount order. */
export function lockBodyScroll(target: ScrollTarget = document.body): () => void {
  let lock = locks.get(target);
  if (!lock) {
    lock = { count: 0, original: target.style.overflow };
    locks.set(target, lock);
  }
  lock.count++;
  target.style.overflow = "hidden";
  let released = false;
  return () => {
    if (released) return;
    released = true;
    lock.count--;
    if (lock.count === 0) {
      target.style.overflow = lock.original;
      locks.delete(target);
    }
  };
}
