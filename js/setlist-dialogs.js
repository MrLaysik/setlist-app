// Dialogs used by setlists: naming a setlist, and picking songs to add.

import { $, h, fmtTime } from "./ui.js";

// ---------- Name a setlist ----------

/**
 * Ask for a setlist name. Resolves with the trimmed name, or null if cancelled.
 * opts: { title, confirmLabel, initial }
 */
export function askName({ title, confirmLabel, initial = "" }) {
  const dlg = $("#nameSheet");
  const input = $("#fName");
  const err = $("#nameError");
  $("#nameTitle").textContent = title;
  $("#nameOk").textContent = confirmLabel;
  input.value = initial;
  err.hidden = true;

  return new Promise((resolve) => {
    const done = (value) => {
      $("#nameForm").removeEventListener("submit", onSubmit);
      $("#nameCancel").removeEventListener("click", onCancel);
      dlg.removeEventListener("cancel", onCancel);
      if (dlg.open) dlg.close();
      resolve(value);
    };
    const onSubmit = (e) => {
      e.preventDefault();
      const name = input.value.trim();
      if (!name) {
        err.textContent = "Give the setlist a name.";
        err.hidden = false;
        input.focus();
        return;
      }
      done(name);
    };
    const onCancel = (e) => { if (e) e.preventDefault(); done(null); };
    $("#nameForm").addEventListener("submit", onSubmit);
    $("#nameCancel").addEventListener("click", onCancel);
    dlg.addEventListener("cancel", onCancel);
    dlg.showModal();
    input.focus();
    if (initial) input.select();
  });
}

// ---------- Pick songs ----------

const norm = (s) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

/**
 * Let the user pick songs. Songs are numbered in the order they're tapped,
 * so a set can be built by tapping through it in running order.
 * opts: { songs (sorted), inSet: Set of song IDs already in the setlist }
 * Resolves with the picked song IDs in tap order, or null if cancelled.
 */
export function pickSongs({ songs, inSet }) {
  const dlg = $("#pickSheet");
  const listEl = $("#pickList");
  const search = $("#pickSearch");
  const okBtn = $("#pickOk");
  const empty = $("#pickEmpty");
  const picked = [];
  const rows = new Map(); // song id -> { li, mark, button }

  function refreshMarks() {
    for (const [id, r] of rows) {
      const n = picked.indexOf(id);
      if (inSet.has(id)) continue;
      r.button.setAttribute("aria-pressed", String(n >= 0));
      r.mark.textContent = n >= 0 ? String(n + 1) : "";
    }
    okBtn.disabled = picked.length === 0;
    okBtn.textContent = picked.length === 0 ? "Add songs"
      : picked.length === 1 ? "Add 1 song" : `Add ${picked.length} songs`;
  }

  function filter() {
    const q = norm(search.value.trim());
    let shown = 0;
    for (const s of songs) {
      const visible = !q || norm(s.title).includes(q);
      rows.get(s.id).li.hidden = !visible;
      if (visible) shown++;
    }
    empty.hidden = shown > 0 || songs.length === 0;
    empty.textContent = "No songs match that.";
  }

  listEl.replaceChildren(...songs.map((s) => {
    const already = inSet.has(s.id);
    const mark = h("span", { className: "pick-mark", "aria-hidden": "true" }, already ? "✓" : "");
    const button = h("button", {
      type: "button",
      className: "pick-row",
      disabled: already,
      onclick: () => {
        const i = picked.indexOf(s.id);
        if (i >= 0) picked.splice(i, 1);
        else picked.push(s.id);
        refreshMarks();
      },
    },
      mark,
      h("span", { className: "pick-main" },
        h("span", { className: "pick-title" }, s.title),
        already ? h("span", { className: "pick-sub" }, "Already in this set") : null),
      h("span", { className: "pick-meta" }, fmtTime(s.lengthSec)));
    if (!already) button.setAttribute("aria-pressed", "false");
    const li = h("li", {}, button);
    rows.set(s.id, { li, mark, button });
    return li;
  }));

  search.value = "";
  search.hidden = songs.length < 8; // only worth it for a bigger library
  if (songs.length === 0) {
    empty.textContent = "There are no songs in your library yet. Add some in the Songs tab first.";
    empty.hidden = false;
  } else {
    empty.hidden = true;
  }
  refreshMarks();

  return new Promise((resolve) => {
    const done = (value) => {
      okBtn.removeEventListener("click", onOk);
      $("#pickCancel").removeEventListener("click", onCancel);
      dlg.removeEventListener("cancel", onCancel);
      search.removeEventListener("input", filter);
      if (dlg.open) dlg.close();
      resolve(value);
    };
    const onOk = () => done(picked.slice());
    const onCancel = (e) => { if (e) e.preventDefault(); done(null); };
    okBtn.addEventListener("click", onOk);
    $("#pickCancel").addEventListener("click", onCancel);
    dlg.addEventListener("cancel", onCancel);
    search.addEventListener("input", filter);
    dlg.showModal();
    listEl.scrollTop = 0;
    $("#pickTitle").focus(); // don't pop the keyboard on open
  });
}
