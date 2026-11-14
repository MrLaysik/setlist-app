// Touch-friendly drag to reorder. Press a row's handle and drag it; the
// other rows slide out of the way, and the list scrolls when you drag near
// its top or bottom edge. Uses pointer events, so touch, Apple Pencil and
// mouse all work.

const EDGE = 72;       // px from the scroller's edge where auto-scroll starts
const MAX_SPEED = 14;  // px per frame at the very edge

/**
 * list:     the <ol>/<ul> whose <li> children get reordered
 * scroller: the element that scrolls the list
 * opts:     { handle: CSS selector for drag handles, onReorder(from, to) }
 * The rows are moved in the DOM before onReorder is called.
 */
export function enableReorder(list, scroller, { handle, onReorder }) {
  list.addEventListener("pointerdown", (e) => {
    const grip = e.target.closest(handle);
    if (!grip || !list.contains(grip) || e.button > 0) return;
    const row = grip.closest("li");
    const rows = [...list.children];
    const from = rows.indexOf(row);
    if (from < 0 || rows.length < 2) return;
    e.preventDefault();

    // Row midpoints at the start; scrolling is added back in as we go.
    const mids = rows.map((r) => {
      const b = r.getBoundingClientRect();
      return b.top + b.height / 2;
    });
    const rowH = row.getBoundingClientRect().height;
    const startY = e.clientY;
    const startScroll = scroller.scrollTop;
    const pointerId = e.pointerId;
    let pointerY = e.clientY;
    let to = from;
    let raf = 0;
    let active = true;

    try { grip.setPointerCapture(pointerId); } catch { /* not supported: listeners still work */ }
    list.classList.add("reordering");
    row.classList.add("dragging");

    function layout() {
      const dy = pointerY - startY + (scroller.scrollTop - startScroll);
      row.style.transform = `translateY(${dy}px)`;
      const center = mids[from] + dy;
      let t = from;
      for (let i = 0; i < from; i++) {
        if (center < mids[i]) { t = i; break; }
      }
      if (t === from) {
        for (let i = rows.length - 1; i > from; i--) {
          if (center > mids[i]) { t = i; break; }
        }
      }
      to = t;
      rows.forEach((r, i) => {
        if (i === from) return;
        let shift = 0;
        if (from < to && i > from && i <= to) shift = -rowH;
        else if (from > to && i >= to && i < from) shift = rowH;
        r.style.transform = shift ? `translateY(${shift}px)` : "";
      });
    }

    function autoScroll() {
      raf = 0;
      if (!active) return;
      const box = scroller.getBoundingClientRect();
      let v = 0;
      if (pointerY < box.top + EDGE) v = -MAX_SPEED * Math.min(1, (box.top + EDGE - pointerY) / EDGE);
      else if (pointerY > box.bottom - EDGE) v = MAX_SPEED * Math.min(1, (pointerY - (box.bottom - EDGE)) / EDGE);
      if (!v) return;
      const before = scroller.scrollTop;
      scroller.scrollTop += v;
      if (scroller.scrollTop !== before) layout();
      raf = requestAnimationFrame(autoScroll);
    }

    function onMove(ev) {
      if (ev.pointerId !== pointerId) return;
      pointerY = ev.clientY;
      layout();
      if (!raf) raf = requestAnimationFrame(autoScroll);
    }

    function finish(commit) {
      if (!active) return;
      active = false;
      cancelAnimationFrame(raf);
      grip.removeEventListener("pointermove", onMove);
      grip.removeEventListener("pointerup", onUp);
      grip.removeEventListener("pointercancel", onCancel);
      // Drop the transition class first so rows snap into place without animating.
      list.classList.remove("reordering");
      row.classList.remove("dragging");
      rows.forEach((r) => { r.style.transform = ""; });
      if (commit && to !== from) {
        list.insertBefore(row, to > from ? rows[to].nextSibling : rows[to]);
        onReorder(from, to);
      }
    }
    const onUp = (ev) => { if (ev.pointerId === pointerId) finish(true); };
    const onCancel = (ev) => { if (ev.pointerId === pointerId) finish(false); };

    grip.addEventListener("pointermove", onMove);
    grip.addEventListener("pointerup", onUp);
    grip.addEventListener("pointercancel", onCancel);
  });
}

/** Return a copy of arr with the item at `from` moved to `to`. */
export function moveItem(arr, from, to) {
  const out = arr.slice();
  const [item] = out.splice(from, 1);
  out.splice(to, 0, item);
  return out;
}
