// Small shared UI helpers.

export const $ = (sel, root = document) => root.querySelector(sel);

/** Seconds -> "m:ss". */
export function fmtTime(sec) {
  const s = Math.max(0, Math.floor(sec || 0));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/** Seconds -> "m:ss", or "h:mm:ss" for an hour or more (set totals). */
export function fmtTotal(sec) {
  const s = Math.max(0, Math.round(sec || 0));
  if (s < 3600) return fmtTime(s);
  const hrs = Math.floor(s / 3600);
  const rest = s % 3600;
  return `${hrs}:${String(Math.floor(rest / 60)).padStart(2, "0")}:${String(rest % 60).padStart(2, "0")}`;
}

export function plural(n, one, many = one + "s") {
  return `${n} ${n === 1 ? one : many}`;
}

/** Create an element: h("div", { className: "x" }, "text", childEl). */
export function h(tag, props = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
    else if (k in el) el[k] = v;
    else el.setAttribute(k, v);
  }
  el.append(...children.filter((c) => c != null && c !== false));
  return el;
}

/** Ask a yes/no question. Resolves true only if the confirm button is tapped. */
export function confirmDialog({ title, message, confirmLabel, danger = false }) {
  const dlg = $("#confirm");
  $("#confirmTitle").textContent = title;
  $("#confirmMsg").textContent = message;
  const ok = $("#confirmOk");
  ok.textContent = confirmLabel;
  ok.classList.toggle("danger-btn", danger);
  ok.classList.toggle("primary", !danger);
  return new Promise((resolve) => {
    const done = (answer) => {
      ok.removeEventListener("click", onOk);
      $("#confirmCancel").removeEventListener("click", onCancel);
      dlg.removeEventListener("cancel", onCancel);
      if (dlg.open) dlg.close();
      resolve(answer);
    };
    const onOk = () => done(true);
    const onCancel = (e) => { if (e) e.preventDefault(); done(false); };
    ok.addEventListener("click", onOk);
    $("#confirmCancel").addEventListener("click", onCancel);
    dlg.addEventListener("cancel", onCancel);
    dlg.showModal();
    $("#confirmCancel").focus();
  });
}

let toastTimer = 0;
/** Brief message at the bottom of the screen. Errors stay up longer. */
export function toast(message, { error = false } = {}) {
  const t = $("#toast");
  t.textContent = message;
  t.classList.toggle("error", error);
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, error ? 8000 : 2500);
}
