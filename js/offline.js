// Offline copy (service worker), "Update ready" banner, and protected storage.

const UPDATE_CHECK_MS = 30 * 60 * 1000; // look for a new version at most this often

let reg = null;
let reloadWhenReady = false;
let lastCheck = 0;

function showBanner() {
  document.getElementById("updateBanner").hidden = false;
}

/** Ask the browser to look for a new version (quietly; offline just fails). */
function checkForUpdate() {
  if (!reg || Date.now() - lastCheck < UPDATE_CHECK_MS) return;
  lastCheck = Date.now();
  reg.update().catch(() => {});
}

/** Show the banner once a new version has fully downloaded and is waiting. */
function watch(worker) {
  if (!worker) return;
  const done = () => {
    // With no controller this is the very first install, not an update.
    if (worker.state === "installed" && navigator.serviceWorker.controller) showBanner();
  };
  done();
  worker.addEventListener("statechange", done);
}

/** Tapping the banner: switch to the new version, then reload. */
function applyUpdate() {
  const waiting = reg && reg.waiting;
  if (!waiting) { location.reload(); return; }
  reloadWhenReady = true;
  waiting.postMessage({ type: "SKIP_WAITING" });
}

export async function startOffline() {
  document.getElementById("updateBanner").addEventListener("click", applyUpdate);
  if (!("serviceWorker" in navigator)) return;

  // Only ever reload because Brad tapped "Update ready". Never on its own.
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (reloadWhenReady) location.reload();
  });

  try {
    reg = await navigator.serviceWorker.register("sw.js");
  } catch (err) {
    console.error("Service worker didn't register:", err);
    return;
  }
  lastCheck = Date.now(); // registering just checked
  if (reg.waiting) watch(reg.waiting);
  if (reg.installing) watch(reg.installing);
  reg.addEventListener("updatefound", () => watch(reg.installing));

  // A home-screen app can stay open for days, so look again when it comes
  // back to the front, and now and then while it's open.
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") checkForUpdate();
  });
  setInterval(checkForUpdate, UPDATE_CHECK_MS);
}

/** Is a full copy of this version saved for offline use? */
export async function offlineReady(version) {
  try {
    if (!("serviceWorker" in navigator) || !navigator.serviceWorker.controller) return false;
    return await caches.has(`setlist-${version}`);
  } catch {
    return false;
  }
}

/**
 * Ask the browser not to clear the app's data when space runs low.
 * Returns true (protected), false (not), or null (browser can't do it).
 */
export async function protectStorage() {
  const s = navigator.storage;
  if (!s || !s.persist || !s.persisted) return null;
  try {
    if (await s.persisted()) return true;
    return await s.persist();
  } catch {
    return false;
  }
}

/** Just check, without asking. Same return values as protectStorage(). */
export async function storageProtected() {
  const s = navigator.storage;
  if (!s || !s.persisted) return null;
  try {
    return await s.persisted();
  } catch {
    return false;
  }
}
