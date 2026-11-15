// Visual metronome: a dot that's amber for the first half of each beat and
// dark for the rest. No sound, no animation, just a solid on/off.
//
// The beat is always worked out from a single start timestamp:
//   phase = (now - start) % beatLen
// Nothing is accumulated from frame to frame, so it can't drift, and it's
// back in time straight away after the app was in the background.

const ON_FRACTION = 0.5;

export function createMetronome({ button, dot, bpmText }) {
  let bpm = 0;
  let running = false;
  let start = 0;
  let lit = false;

  function setLit(on) {
    if (on === lit) return;
    lit = on;
    dot.classList.toggle("on", on);
  }

  function render() {
    button.setAttribute("aria-pressed", running ? "true" : "false");
    button.setAttribute("aria-label", bpm
      ? `Metronome, ${bpm} BPM, ${running ? "on" : "off"}. Tap to turn ${running ? "off" : "on"}.`
      : "Metronome");
  }

  return {
    /** Load a tempo and start counting from beat one right now. */
    start(newBpm) {
      bpm = Number(newBpm) > 0 ? Number(newBpm) : 0;
      bpmText.textContent = bpm ? String(bpm) : "–";
      button.disabled = !bpm;
      running = !!bpm;
      start = performance.now();
      setLit(false);
      render();
      this.tick(start);
    },

    stop() {
      running = false;
      setLit(false);
      render();
    },

    /** Tapping the metronome: on starts again from beat one. */
    toggle() {
      if (running) this.stop();
      else if (bpm) this.start(bpm);
    },

    isRunning() {
      return running;
    },

    /** Call every frame. */
    tick(now) {
      if (!running) return;
      const beatLen = 60000 / bpm;
      const phase = (((now - start) % beatLen) + beatLen) % beatLen;
      setLit(phase < beatLen * ON_FRACTION);
    },
  };
}
