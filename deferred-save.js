// 切页面时的「延后合并保存」：只换了当前页面（state.route）时不必立刻整份保存。
// 多次切页面合并成一次；真正的数据保存（save()）会顺带写入当前页面，所以届时取消待办即可。
// 页面隐藏 / 关闭 / App 进后台时立即补写，不丢东西。
export function createDeferredSave({
  save,
  delay = 1200,
  setTimer = (fn, ms) => setTimeout(fn, ms),
  clearTimer = id => clearTimeout(id),
  idle = typeof requestIdleCallback === 'function' ? (fn => requestIdleCallback(fn, { timeout: 1000 })) : null,
} = {}) {
  let timer = null;
  let pending = false;
  const run = () => {
    timer = null;
    if (!pending) return undefined;
    pending = false;
    return Promise.resolve().then(save).catch(() => {});
  };
  return {
    request() {
      pending = true;
      if (timer !== null) return;
      timer = setTimer(() => { if (idle) idle(run); else run(); }, delay);
    },
    flush() {
      if (timer !== null) { clearTimer(timer); timer = null; }
      return run();
    },
    cancelPending() {
      pending = false;
      if (timer !== null) { clearTimer(timer); timer = null; }
    },
    get pending() { return pending; },
  };
}
