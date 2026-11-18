// Keep the screen awake in the performance view (Screen Wake Lock).
//
// The iPad drops the lock whenever the app goes to the background, so it's
// asked for again each time the app comes back. The indicator always shows
// the real state, and tapping it tries again.

export function createWakeLock({ button, text }) {
  let wanted = false;   // in the performance view
  let lock = null;

  function show(on) {
    button.classList.toggle("on", on);
    text.textContent = on ? "Screen stays on" : "Screen may sleep";
    button.setAttribute("aria-label", on
      ? "Screen stays on"
      : "Screen may sleep. Tap to try keeping it on.");
  }

  async function request() {
    if (!wanted || lock) { show(!!lock); return; }
    if (!("wakeLock" in navigator) || document.visibilityState !== "visible") { show(false); return; }
    try {
      const l = await navigator.wakeLock.request("screen");
      if (!wanted) { l.release().catch(() => {}); return; }
      lock = l;
      l.addEventListener("release", () => {
        if (lock === l) { lock = null; show(false); }
      });
      show(true);
    } catch (err) {
      console.warn("Wake lock refused:", err);
      show(false);
    }
  }

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible" && wanted) request();
  });
  button.addEventListener("click", request);

  return {
    /** Entering the performance view. */
    start() {
      wanted = true;
      request();
    },
    /** Leaving it. */
    stop() {
      wanted = false;
      const l = lock;
      lock = null;
      if (l) l.release().catch(() => {});
      show(false);
    },
    isOn: () => !!lock,
  };
}
