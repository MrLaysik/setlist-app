// Setlist app entry point.
// Milestone 0: just the shell. Shows whether we're running as an installed
// app (full screen) or in a browser tab, plus the app version.

const APP_VERSION = "0.0.1";

function isInstalled() {
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    window.navigator.standalone === true // older iPadOS Safari
  );
}

function renderStatus() {
  document.getElementById("diagMode").textContent = isInstalled()
    ? "Installed app (full screen)"
    : "Browser tab";
  document.getElementById("diagVersion").textContent = APP_VERSION;
}

renderStatus();
