/**
 * Claude Code Desktop-style reasoning effort slider — Client half.
 *
 * Replaces the 「推理等级」 ROW of DSH's native model menu with the slider, in
 * place. The native `GLM-x · Max` pill (the `conversation.input.model` seat)
 * stays untouched, and the 「模型 ›」 row keeps switching models; opening the
 * menu shows the slider immediately where the effort row used to be, with no
 * drill-in step. A renderless probe registered in the composer's session scope
 * captures the same per-session directory the native seat uses; a
 * MutationObserver finds the portaled menu card, locates the second
 * `menuitem` row by structure (not locale text or hashed class names), inserts
 * a host node before it (a node React never created, so reconciliation leaves
 * it alone), hides the native row and drops its role so native focus queries
 * skip it, and mounts the slider with its own React root. The observer drops
 * mutations caused by its own hosts and coalesces sweeps per animation frame,
 * so the slider's own DOM churn never re-triggers it. Commits go through the
 * identical `directory.select` path, and the slider reads the same store, so
 * `/model` and the slider agree. The last stop plays the Claude "Ultracode"
 * lavender pixel-field animation.
 *
 * Plain-JS React (createElement) — the Client module loader evaluates lazy CJS
 * sources without a JSX transform, matching the shipped decoration template.
 *
 * Animation parameters follow the Claude Code Desktop effect as recreated by
 * the published MIT references (see README): spring stiffness 920 / damping 40,
 * 3px blur-crossfade level label, 1.6s right→left reveal sweep, ~30fps canvas.
 */
window.__ModuleLoader__.load({
  id: '@local/claude-effort-slider',
  factory(require) {
    const React = require('react');
    const ReactDOMClient = require('react-dom/client');
    const ReactDOM = require('react-dom');
    const h = React.createElement;
    const {
      useState, useRef, useEffect, useLayoutEffect, useMemo, useCallback,
      useSyncExternalStore, useId,
    } = React;

    // Trailing control group; `order < 0` places the chip first in the group,
    // i.e. immediately left of the native model pill.
    const SLOT = 'conversation.input.right';
    const SLOT_ORDER = -10;
    const NS = 'claudeEffort';
    // The native model-selection UI's dictionary namespace. Its dictionary
    // holds the label the composer pill shows for the Auto level ("Default"
    // in zh and en, translated per language elsewhere). The slider reads the
    // SAME key so the card and the pill can never drift apart.
    // NOT the package name: that UI registers its dictionaries under the
    // short namespace 'model' (ui-model-selection index.ts: NS = 'model').
    // Binding the package name finds nothing, bind() returns the key itself,
    // and the fallback below silently put the old label back.
    const NATIVE_NS = 'model';

    // --- Researched motion parameters (see README, "Sources") -------------
    const SPRING_STIFFNESS = 920;   // zanwei reference spring
    const SPRING_DAMPING = 40;
    const MAGNET_RADIUS = 0.5;      // drag magnetism reach, in stops
    const LABEL_SWAP_MS = 200;      // label crossfade window
    // Reveal sweep length on a STOP CHANGE (drag to another level): half the
    // reference port's 1.6s so the field fills the track twice as fast.
    // The menu-open path never runs this sweep (see the back-dated start in
    // the reveal effect), so this only affects an in-card level switch.
    const REVEAL_MS = 800;
    const FRAME_MS = 33;            // canvas cap ≈ 30fps once settled
    // During the reveal sweep the per-cell `appear` ramp and the ragged front
    // cost more than the idle wave, and the first stop that ever gets a field
    // (Low on an off/low/high/max scale) also pays the one-time bitmap
    // allocation right then — the hitch felt as "Low is laggy". The sweep is
    // fast motion, so 20fps is indistinguishable there; run it at 20 and
    // step up to 30 once the field is idle.
    const REVEAL_FRAME_MS = 50;

    // --- Tiny math helpers -------------------------------------------------
    const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
    /** Normalised track progress (0..1) for a stop-space value. */
    const progressOf = (value, count) => (count > 1 ? value / (count - 1) : 0);
    // --- Per-model effort memory ---------------------------------------------
    // Remembers the effort the user last picked on each model so switching
    // back to it restores that level instead of the catalog default. Stored
    // under provider/model in localStorage (survives restarts); the value is
    // the adapter effort id, or null for Auto. Best-effort: storage may be
    // unavailable (private mode, quota) and nothing here may throw.
    const MEMORY_KEY = 'claude-effort-slider:memory:v1';
    const memoryKey = (provider, model) => `${provider}/${model}`;
    const readMemory = () => {
      try {
        const raw = window.localStorage.getItem(MEMORY_KEY);
        const parsed = raw === null ? {} : JSON.parse(raw);
        return parsed !== null && typeof parsed === 'object' ? parsed : {};
      } catch {
        return {};
      }
    };
    const recallEffort = (provider, model) => {
      const entry = readMemory()[memoryKey(provider, model)];
      // Only accept a string id or the explicit Auto marker; anything else
      // (corrupt, old shape) is treated as "no memory".
      if (entry === null || typeof entry === 'string') return entry;
      return undefined;
    };
    const rememberEffort = (provider, model, effortId) => {
      try {
        const all = readMemory();
        all[memoryKey(provider, model)] = effortId === undefined ? null : effortId;
        window.localStorage.setItem(MEMORY_KEY, JSON.stringify(all));
      } catch { /* storage unavailable — memory is best-effort */ }
    };
    // The model the slider last saw (provider/model). Module level so it
    // survives the slider being unmounted while the user browses the native
    // model list; a restore fires only when this actually changes.
    let lastModelKey = null;
    // Set by FaceProbe when the model changed while the native menu was open
    // (= the user picked a model in the list); consumed by the injector once
    // the closing card has left the DOM. Module level for the same reason as
    // lastModelKey: the two live in different mount lifetimes.
    let reopenRequest = false;
    /**
     * Pixel-field tone for a stop, keyed by distance from the END of the
     * scale so it stays attached to the same levels whatever the model's
     * effort count: last = violet, one below = blue, two below = green. The
     * first stop (Off) never gets a field. Auto — the synthetic stop with no
     * id, present only when the catalog declares no default — is the one
     * exception and gets a rainbow field. Identified by `id === undefined`,
     * never by index. Shared by the slider (field lifecycle) and the probe
     * (so the composer pill's level text can be tinted while the menu is
     * closed and the slider is not mounted).
     */
    const toneOf = (stops, index) => {
      const stop = stops[index];
      if (stop === undefined) return null;
      if (stop.id === undefined) return 'rainbow';
      const fromEnd = stops.length - 1 - index;
      if (fromEnd === 0) return 'violet';
      if (fromEnd === 1) return 'blue';
      if (fromEnd === 2 && index >= 1) return 'green';
      return null;
    };
    /** { route, reasoning } for the current selection, or nulls. */
    const selectionFromSnapshot = (snapshot) => {
      if (snapshot === null) return { route: null, reasoning: undefined };
      const route = snapshot.current;
      if (route === null || route === undefined) return { route: null, reasoning: undefined };
      const group = snapshot.groups.find((entry) => entry.id === route.provider);
      const model = group === undefined ? undefined : group.models.find((entry) => entry.id === route.model);
      return { route, reasoning: model === undefined ? undefined : model.reasoning };
    };
    /**
     * Tone of the COMMITTED selection straight from a directory snapshot —
     * the same stop list and index rules EffortChip uses, without the locale
     * names (tone depends only on ids and positions). Used by the always-
     * mounted probe so the composer pill's level text stays tinted while the
     * menu (and therefore the slider) is closed.
     */
    const toneFromSnapshot = (snapshot) => {
      const { route, reasoning } = selectionFromSnapshot(snapshot);
      if (route === null || reasoning === undefined) return null;
      const ids = [];
      // Same order as EffortChip's stops: off, auto, low, high, Max.
      if (reasoning.efforts.some((effort) => effort.id === 'off')) ids.push('off');
      if (reasoning.defaultEffort === undefined) ids.push(undefined);
      for (const effort of reasoning.efforts) {
        if (effort.id === 'off') continue;
        ids.push(effort.id);
      }
      const effective = route.reasoningEffort !== undefined ? route.reasoningEffort : reasoning.defaultEffort;
      const index = ids.findIndex((id) => id === effective);
      return toneOf(ids.map((id) => ({ id })), index === -1 ? 0 : index);
    };
    const smooth = (edge0, edge1, value) => {
      const x = clamp((value - edge0) / (edge1 - edge0), 0, 1);
      return x * x * (3 - 2 * x);
    };
    const hash2 = (x, y, a, b) =>
      (Math.abs(Math.sin(x * a + y * b) * 43758.5453) % 1);

    const isDarkTheme = () =>
      typeof document !== 'undefined' && document.body !== null
      && document.body.hasAttribute('data-ds-dark-theme');

    const prefersReducedMotion = () =>
      typeof window !== 'undefined'
      && window.matchMedia !== undefined
      && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    // --- Ultracode pixel field ---------------------------------------------
    // Three layers per frame, following the reverse-engineered parameter
    // manual of the reference port (ANIMATION.md, measured against official
    // Claude screenshots) plus the per-cell variance lessons from the
    // community dither libraries:
    //   ① canvas wash — a lavender gradient that grows with the reveal front
    //   ② base blocks — rounded mosaic with per-cell inherent alpha/color
    //     variance (the mosaic texture lives here, not in a uniform grid)
    //   ③ highlights — crest and front flashes drawn inside each block
    // Grid: rows tile the track height exactly (cell = height / rows), so no
    // half-row is ever clipped; light theme keeps a visible 12% seam.

    const FIELD_ROWS = 6;

    // Rounded-rect path with a fallback for older canvases.
    function traceBlock(context, x, y, size, radius) {
      context.beginPath();
      if (context.roundRect !== undefined) context.roundRect(x, y, size, size, radius);
      else context.rect(x, y, size, size);
    }

    /**
     * A black-on-transparent image of the particle grid for a canvas of the
     * given backing-store size, used as a CSS mask by the rainbow tint
     * overlay so the tint lands on cells only — never on the translucent
     * wash between them. The geometry below is a verbatim copy of the
     * sizing math in drawPixelField (rows, cell, columns, block, inset,
     * radius, and the device-pixel snap of each cell), because the mask has
     * to register with the painted cells pixel for pixel; change one, change
     * the other. Painted at the canvas's own backing resolution so the CSS
     * box (sized to the track) downsamples it the same way it does the
     * canvas. The light theme fills 88% of each cell, the dark theme 72%
     * (a wider seam), so the theme is a parameter — a mask sized for the
     * wrong theme would leave a ring of wash tinted around every cell.
     *
     * Per-cell light/dark grain, randomised: the tint is a pure hue (each
     * channel 0 or full), so multiply leaves the particles' own per-cell
     * lightness only in one channel — the mosaic read as one flat band per
     * colour. The alternation is therefore encoded HERE, in the mask's
     * alpha. Its source is the SAME position hash the painter uses for a
     * cell's inherent alpha (hash2 with the constants 12.9898 / 78.233),
     * so the grain sits in phase with where the painted cells are
     * themselves light and dark, and it never moves in time (hash2 has no
     * time term) — unpredictable but perfectly stable, no flicker, and
     * never a checkerboard.
     *
     * Why two octaves: a hash sampled per cell is white noise — every
     * neighbour an independent step — which read as static (measured: mean
     * neighbouring |Δalpha| 0.27, max 0.60). The grain is therefore 70% a
     * LOW-frequency sample (one value per 3x2 patch, so light and dark
     * drift in soft regions and the field has a body) and 30% the per-cell
     * hash (so patch edges never harden into a visible block pattern). The
     * alpha band is also narrow (low..high below) and only gently centred:
     * a wide swing with strong stretching is what made it look busy.
     * @returns {string} a PNG data URL.
     */
    function gridMaskDataUrl(width, height, ratio, dark) {
      const mask = document.createElement('canvas');
      mask.width = width;
      mask.height = height;
      const context = mask.getContext('2d');
      if (context === null) return '';
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
      const cssWidth = width / ratio;
      const cssHeight = height / ratio;
      const rows = cssHeight >= 30 ? FIELD_ROWS : 5;
      const cell = cssHeight / rows;
      const columns = Math.ceil(cssWidth / cell);
      const block = Math.max(1, Math.floor(cell * (dark ? 0.72 : 0.88) * ratio) / ratio);
      const inset = (cell - block) * 0.5;
      const radius = Math.min(block * 0.24, 1.1);
      // Alpha band of the grain. The dark theme's particles are already dim;
      // a grain as faint as the light theme's would sink into the wash and
      // read as holes, so the band is lifted there. Kept narrow on purpose:
      // a 0.4–1.0 swing is what made the first cut look like static.
      const low = dark ? 0.58 : 0.5;
      const high = 0.9;
      for (let row = 0; row < rows; row += 1) {
        for (let column = 0; column < columns; column += 1) {
          const px = Math.round((column * cell + inset) * ratio) / ratio;
          const py = Math.round((row * cell + inset) * ratio) / ratio;
          // Two octaves of the SAME position hash the painter uses, so the
          // grain stays in phase with the cells' inherent alpha and never
          // moves in time:
          //   low  — one value per 3x2 patch of cells. Neighbouring cells
          //          share it, which is what gives the field its "body":
          //          light and dark drift across the track in soft regions
          //          instead of changing at every cell.
          //   h1   — the painter's own per-cell hash, kept at a small
          //          weight so the patch edges never harden into a visible
          //          block pattern and the grain stays irregular.
          // Both use hash2 with the painter's constants; a different hash or
          // constants would drift out of phase with the painted cells.
          const lowFreq = hash2(Math.floor(column / 3), Math.floor(row / 2), 12.9898, 78.233);
          const h1 = hash2(column, row, 12.9898, 78.233);
          const mixed = 0.7 * lowFreq + 0.3 * h1;
          // Gentle centring (x1.2, not x1.6): enough to tell light from
          // dark, not enough to turn the mix back into salt-and-pepper.
          const centred = clamp(0.5 + (mixed - 0.5) * 1.2, 0, 1);
          context.globalAlpha = low + (high - low) * centred;
          context.fillStyle = '#000';
          traceBlock(context, px, py, block, radius);
          context.fill();
        }
      }
      return mask.toDataURL('image/png');
    }

    function drawPixelField(canvas, startedAt, now) {
      const context = canvas.getContext('2d');
      if (context === null || canvas.width === 0) return;
      const ratio = Math.min(window.devicePixelRatio || 1, 2);
      const width = canvas.width / ratio;
      const height = canvas.height / ratio;
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
      context.clearRect(0, 0, width, height);

      const dark = isDarkTheme();
      const elapsed = Math.max(0, now - startedAt);
      // Sweep progress 0→1; `front` travels right edge (1) → left edge (0).
      const sweep = prefersReducedMotion() ? 1 : Math.min(elapsed / REVEAL_MS, 1);
      const front = 1 - smooth(0, 1, sweep);
      const sweeping = sweep < 0.999;

      // Grid: exact tiling; blocks keep the reference's seam and rounding
      // (light 88% fill / dark 72%, corner radius ≈ 1.1 CSS px).
      const rows = height >= 30 ? FIELD_ROWS : 5;
      const cell = height / rows;
      const columns = Math.ceil(width / cell);
      const fillRatio = dark ? 0.72 : 0.88;
      const block = Math.max(1, Math.floor(cell * fillRatio * ratio) / ratio);
      const inset = (cell - block) * 0.5;
      const radius = Math.min(block * 0.24, 1.1);

      // Per-row idle wave parameters: 3–7 crests per row on the primary wave,
      // 2–5 on the secondary, row-own speed 5–15 rad/s. Phase velocity of the
      // two waves matches, so the texture only drifts left as one body.
      const waves = [];
      for (let row = 0; row < rows; row += 1) {
        waves.push({
          n1: 3 + Math.floor(hash2(row, 1, 7.7, 13.1) * 5),
          n2: 2 + Math.floor(hash2(row, 2, 5.3, 11.7) * 4),
          speed: 5 + hash2(row, 3, 9.1, 17.3) * 10,
          phase: hash2(row, 4, 3.7, 23.7) * Math.PI * 2,
        });
      }
      const TAU = Math.PI * 2;
      const seconds = elapsed / 1000;

      // ① Wash: lavender that follows the front — transparent ahead of it,
      // saturated behind it, covering the whole track once the sweep ends.
      const washA = dark ? [112, 78, 162] : [142, 118, 192];
      const wash = context.createLinearGradient(0, 0, width, 0);
      const stop0 = Math.max(front - 0.08, 0);
      const stop1 = Math.min(front + 0.18, 1);
      wash.addColorStop(0, `rgba(${washA[0]},${washA[1]},${washA[2]},0)`);
      wash.addColorStop(stop0, `rgba(${washA[0]},${washA[1]},${washA[2]},0)`);
      wash.addColorStop(stop1, `rgba(${washA[0]},${washA[1]},${washA[2]},${dark ? 0.55 : 0.45})`);
      wash.addColorStop(1, `rgba(${washA[0]},${washA[1]},${washA[2]},${dark ? 0.75 : 1})`);
      context.fillStyle = wash;
      context.fillRect(0, 0, width, height);

      context.save();
      context.beginPath();
      if (context.roundRect !== undefined) context.roundRect(0, 0, width, height, 10);
      else context.rect(0, 0, width, height);
      context.clip();

      for (let row = 0; row < rows; row += 1) {
        const wave = waves[row];
        for (let column = 0; column < columns; column += 1) {
          const x = column * cell;
          const y = row * cell;
          const t = (x + cell * 0.5) / width;
          const h1 = hash2(column, row, 12.9898, 78.233);
          const h2 = hash2(column, row, 15.3, 31.7);
          const h3 = hash2(column, row, 8.3, 27.1);

          // Reveal: the front edge jitters ±2.5% per column so the sweep
          // reads ragged rather than ruler-straight; a freshly swept column
          // ramps in over 4% of the track width.
          const edgeJit = (hash2(column, row, 4.7, 19.3) - 0.5) * 0.05;
          const local = t - front - edgeJit;
          if (local < 0) continue;
          const appear = 0.35 + 0.65 * clamp(local / 0.04, 0, 1);

          // Dual idle waves. Phase depends only on column, row and time —
          // never on per-cell noise (the reference measured that per-cell
          // phase jitter makes neighbours light in the wrong order).
          const w1 = ((column / columns) * wave.n1 * TAU + wave.phase - wave.speed * seconds) / TAU;
          const u1 = ((w1 % 1) + 1) % 1;
          const w2 = ((column / columns) * wave.n2 * TAU + wave.phase * 1.7 - wave.speed * (wave.n2 / wave.n1) * seconds) / TAU;
          const u2 = ((w2 % 1) + 1) % 1;
          const exp1 = 2.6 + h1 * 3.4;
          const pulse = Math.max(
            Math.pow(1 - u1, exp1),
            Math.pow(1 - u2, 3.4) * (0.55 + h3 * 0.45),
          ) * 0.85;

          // Slow flicker gates whether a cell is present at all, so idle
          // cells come and go instead of strobing.
          const flick = 0.5 + 0.5 * Math.sin(column * 1.7 + row * 2.3 + seconds * 1.5 * (1 + h1));
          const gap = 0.6 + 0.4 * clamp((flick - (1 - sweep) * 0.5) / 0.3, 0, 1);

          // Inherent per-cell alpha: the mosaic texture lives in this term
          // (a uniform alpha reads as a sticker, not a mosaic). The left end
          // stays present — no transparent zone.
          const base = (0.92 + 0.08 * t) * (0.25 + 0.75 * h1);
          const gridAlpha = clamp(base * gap * appear * 1.1 * (0.9 + 0.1 * h3), 0, 1);
          if (gridAlpha <= 0.01) continue;

          // ② Base block. Light theme: measured median (187−32t, 184−46t,
          // 206+4t) with a spread that widens rightward (22+66t) — left
          // cells agree, right cells split between deep purple and bright
          // lavender. Dark theme ramps gray-violet → saturated purple.
          let br; let bg; let bb;
          if (dark) {
            const purple = smooth(0, 0.95, t);
            const offc = (h2 - 0.42) * (18 + 40 * t);
            br = 56 + (150 - 56) * purple + offc;
            bg = 52 + (118 - 52) * purple + offc * 0.8;
            bb = 68 + (210 - 68) * purple + offc * 0.3;
          } else {
            const offc = (h2 - 0.42) * (22 + 66 * t);
            if (offc > 0) {
              // brighter: toward the highlight lavender
              br = 187 - 32 * t + offc * 1.5;
              bg = 184 - 46 * t + offc * 1.6;
              bb = 206 + 4 * t + offc * 1.1;
            } else {
              // deeper: sink all channels, green hardest
              br = 187 - 32 * t + offc * 1.0;
              bg = 184 - 46 * t + offc * 1.35;
              bb = 206 + 4 * t + offc * 0.7;
            }
          }
          br = clamp(br, 0, 255);
          bg = clamp(bg, 0, 255);
          bb = clamp(bb, 0, 255);
          const px = Math.round((x + inset) * ratio) / ratio;
          const py = Math.round((y + inset) * ratio) / ratio;
          context.globalAlpha = gridAlpha * (dark ? 0.6 : 0.8);
          context.fillStyle = `rgb(${Math.round(br)},${Math.round(bg)},${Math.round(bb)})`;
          traceBlock(context, px, py, block, radius);
          context.fill();

          // ③ Highlight: crest white-lavender drawn inside the block (14%
          // inset). During the sweep, the front flashes cells within 16% of
          // the front so the sweep reads as a cascade of ignitions.
          let whiteAmt = pulse * (0.35 + 0.65 * t) * (0.55 + 0.45 * h1);
          if (sweeping) {
            const flash = clamp(1 - local / 0.16, 0, 1) * (0.55 + 0.45 * h1);
            whiteAmt = Math.max(whiteAmt, flash);
          }
          if (whiteAmt > 0.02) {
            context.globalAlpha = gridAlpha * (dark
              ? 0.18 + 0.62 * whiteAmt
              : 0.12 + 0.88 * whiteAmt);
            context.fillStyle = dark ? 'rgb(220,204,255)' : 'rgb(247,243,255)';
            const inset2 = block * 0.14;
            traceBlock(context, px + inset2, py + inset2, block - inset2 * 2, radius * 0.6);
            context.fill();
          }
        }
      }
      context.restore();
      context.globalAlpha = 1;
    }

    // --- Locale dictionaries (Client runtime) -------------------------------
    const zh = {
      'chip.aria': '思考强度，当前 {effort}',
      'chip.none': '思考强度：当前模型未提供推理等级',
      'effort.none': '无推理等级',
      'panel.title': '思考强度',
      'axis.faster': '更快',
      'axis.smarter': '更智能',
      'effort.auto': '自动',
      'tip.text': '更高的强度会花更多时间思考。最后一档播放 Ultracode 像素动画。',
      'error.writerHeld': '当前会话已被占用（可能有另一个正在运行的 DSH），稍后再试。',
      'error.select': '设置失败：{message}',
    };
    const en = {
      'chip.aria': 'Effort level, current {effort}',
      'chip.none': 'Effort level: this model offers no reasoning levels',
      'effort.none': 'No levels',
      'panel.title': 'Effort',
      'axis.faster': 'Faster',
      'axis.smarter': 'Smarter',
      'effort.auto': 'Auto',
      'tip.text': 'Higher effort spends more time reasoning. The last stop plays the Ultracode pixel animation.',
      'error.writerHeld': 'This session is busy (another running DSH may hold it). Try again shortly.',
      'error.select': 'Selection failed: {message}',
    };

    // --- Global stylesheet ---------------------------------------------------
    const STYLE = `
.ces-root { position: relative; min-width: 0;
  --ces-accent: #8c73c9;
  --ces-track: #edeae8;
  --ces-fill: #e0dbd6;
  --ces-tick: #b6b2af;
  --ces-thumb: #ffffff;
  --ces-thumb-border: rgba(76, 70, 65, 0.16);
  --ces-thumb-w: 24px;
  --ces-thumb-h: 26px;
}
body[data-ds-dark-theme] .ces-root {
  --ces-accent: #a88ccf;
  --ces-track: #26232e;
  --ces-fill: rgba(255, 255, 255, 0.08);
  --ces-tick: #57525f;
  --ces-thumb: #f2f0f4;
  --ces-thumb-border: rgba(0, 0, 0, 0.4);
}
.ces-chip {
  anchor-name: var(--ces-anchor);
  display: flex; align-items: center; gap: 4px;
  height: 28px; padding: 0 6px 0 8px;
  border: none; border-radius: var(--dsw-radius-sm, 6px); outline: none;
  background: transparent; cursor: pointer;
  color: var(--dsw-alias-label-secondary);
  font-size: 13px; line-height: 20px; font-weight: 400;
  transition: color 150ms ease, opacity 150ms ease;
}
@media (hover: hover) {
  .ces-chip:hover:not(:disabled) { background: var(--dsw-alias-interactive-bg-hover); }
}
.ces-chip:focus-visible { box-shadow: 0 0 0 2px var(--dsw-focus-ring-color, var(--dsw-alias-state-business-primary)); }
.ces-chip:disabled { cursor: default; opacity: 0.55; }
.ces-chip[data-ultra] { color: var(--ces-accent); }
.ces-chip-icon { flex: 0 0 auto; width: 14px; height: 14px; }
.ces-chip-label { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.ces-chevron { flex: 0 0 auto; color: var(--dsw-alias-label-caption); transition: transform 120ms ease; }
.ces-root[data-open] .ces-chevron { transform: rotate(180deg); }

.ces-panel {
  position: fixed;
  position-anchor: var(--ces-anchor);
  /* Right-align to the chip (the chip now sits in the trailing group), with a
     safe fallback toward the left when the viewport is narrow. */
  right: anchor(right);
  left: auto;
  bottom: calc(anchor(top) + 8px);
  justify-self: safe end;
  box-sizing: border-box;
  width: 360px;
  max-width: min(360px, calc(100vw - 24px));
  z-index: 1100;
  padding: 14px 16px 16px;
  border: 0;
  border-radius: 16px;
  background: var(--dsw-alias-bg-overlay, #fff);
  --dsw-elevation-stroke-color: var(--dsw-alias-border-l1);
  box-shadow: var(--dsw-elevation-prominent, 0 8px 28px rgba(0,0,0,0.18));
  color: var(--dsw-alias-label-primary);
  font-size: 13px; line-height: 20px;
  transform-origin: bottom left;
  animation: ces-panel-in 140ms cubic-bezier(0.2, 0, 0, 1);
}
.ces-root[data-closing] .ces-panel { pointer-events: none; animation: ces-panel-out 120ms ease-in forwards; }
/* Inline variant — replaces the 「推理等级」 row of the native model menu.
   Layout follows the reference (attachment 1): one compact control made of a
   header row (glyph · label · level badge · chevron) over a pill-shaped
   solid-fill track with a white thumb and stop dots.

   Sizing: the native card is pinned to the right edge and its width is
   decided by its min-width (240px) rather than by fit-content, so a fixed-width
   host would simply be clipped by the card's overflow: hidden. Instead the
   host fills the card's content box, and the card itself is widened (via the
   data-ces-card attribute the injector sets) to a comfortable 300px that
   still sits inside the card's own 240-420px bounds. The track therefore
   always spans the exact inner width - never wider, never clipped. */
body > [role="menu"][data-ces-card] { min-width: 300px; }
.ces-inline {
  width: 100%; box-sizing: border-box;
  padding: 2px 8px 8px;
  --ces-accent: #3b6fe0;
  --ces-track: #e9edf5;
  --ces-fill: #3b6fe0;
  --ces-tick: rgba(255, 255, 255, 0.55);
  --ces-thumb: #ffffff;
  --ces-thumb-border: rgba(20, 30, 60, 0.14);
  --ces-thumb-w: 26px;
  --ces-thumb-h: 26px;
}
body[data-ds-dark-theme] .ces-inline {
  --ces-accent: #6f9cf0;
  --ces-track: #2a2f3c;
  --ces-fill: #3b6fe0;
  --ces-tick: rgba(255, 255, 255, 0.45);
}
.ces-inject-host { width: 100%; box-sizing: border-box; isolation: isolate; }
/* The badge slot lives inside the native 「模型」 row's right-aligned value
   cell and reads like the composer pill: GLM-5.4 · Max. Plain caption text,
   with the level name cross-fading through .ces-stage. */
.ces-badge-slot {
  --ces-accent: #3b6fe0;
  display: inline-flex; align-items: center; gap: 0;
  margin-left: 4px; vertical-align: baseline;
  color: var(--dsw-alias-label-tertiary, var(--dsw-alias-label-caption));
  white-space: nowrap;
}
body[data-ds-dark-theme] .ces-badge-slot { --ces-accent: #6f9cf0; }
.ces-badge-slot .ces-stage { position: relative; display: inline-block; height: 20px; line-height: 20px; }
/* Level text takes the tone of its own particle field. The tone is mirrored
   onto <html data-ces-tone> by the always-mounted FaceProbe so BOTH
   places that show the level can read it: our badge inside the card, and
   the native composer pill's effort span (a hashed CSS-module class, so it
   is addressed structurally: the last span child of the aria-haspopup menu
   button). Each tone uses the dominant hue of its field at a lightness that
   reads as text, not as the wash itself: violet is #7a5fc0 on light (L 56%
   S 43%, contrast 4.97:1 on white — AA; the wash end #524472 sat at L 36%
   and read as near-black) and #cdbfee on dark (L 84%, 9.6:1). */
html[data-ces-tone="violet"] { --ces-tone: #7a5fc0; --ces-tone-dark: #cdbfee; }
html[data-ces-tone="blue"] { --ces-tone: #3b6fe0; --ces-tone-dark: #6f9cf0; }
html[data-ces-tone="green"] { --ces-tone: #2e9e6b; --ces-tone-dark: #5fcf98; }
html[data-ces-tone="rainbow"] { --ces-tone: #7c5cf0; --ces-tone-dark: #a78bfa; }
/* Dark theme swaps to the lifted variant (body carries the theme marker). */
html:has(body[data-ds-dark-theme])[data-ces-tone] { --ces-tone: var(--ces-tone-dark); }
/* Our badge: coloured by its OWN data-tone (the previewed stop while
   dragging), so it never waits on the committed value. Off/none keeps the
   caption grey. */
.ces-badge-slot .ces-stage[data-tone="violet"] .ces-in { color: #7a5fc0; }
.ces-badge-slot .ces-stage[data-tone="blue"] .ces-in { color: #3b6fe0; }
.ces-badge-slot .ces-stage[data-tone="green"] .ces-in { color: #2e9e6b; }
.ces-badge-slot .ces-stage[data-tone="rainbow"] .ces-in { color: #7c5cf0; }
body[data-ds-dark-theme] .ces-badge-slot .ces-stage[data-tone="violet"] .ces-in { color: #cdbfee; }
body[data-ds-dark-theme] .ces-badge-slot .ces-stage[data-tone="blue"] .ces-in { color: #6f9cf0; }
body[data-ds-dark-theme] .ces-badge-slot .ces-stage[data-tone="green"] .ces-in { color: #5fcf98; }
body[data-ds-dark-theme] .ces-badge-slot .ces-stage[data-tone="rainbow"] .ces-in { color: #a78bfa; }
/* Max badge text is bold; every other stop keeps the inherited weight. The
   sizer bolds with it so the hidden width probe measures the same glyphs
   (the stage would otherwise be sized for regular weight). The colour
   rules above stay untouched — this only adds weight. */
.ces-badge-slot .ces-stage[data-tone="violet"] .ces-in,
.ces-badge-slot .ces-stage[data-tone="violet"] .ces-sizer { font-weight: 600; }
/* Native composer pill (GLM-5.4 · Max): the effort word is the last span
   inside the menu button; it follows the COMMITTED tone on <html>.
   Scoped by [title*=" · "]: aria-haspopup="menu" alone is shared by 30+
   DSH buttons (the sidebar "more" button, the account menu at bottom-left,
   settings rows ...), and an earlier cut that keyed on it alone recoloured
   those too. The model pill is the ONE menu button that sets a title, in
   the fixed form "model · effort" (ModelSelect.tsx: triggerLabel), so the
   middle-dot substring identifies it exactly; a model without efforts has
   no effort word and no tone, so it never needs these rules. */
html[data-ces-tone] button[aria-haspopup="menu"][title*=" · "] > span:last-of-type { color: var(--ces-tone); }
/* Same for the pill: bold only when the committed tone is violet (Max). */
html[data-ces-tone="violet"] button[aria-haspopup="menu"][title*=" · "] > span:last-of-type { font-weight: 600; }
.ces-inline .ces-track-shell { height: 34px; margin-top: 0; }
.ces-inline-icon {
  flex: 0 0 auto; width: 15px; height: 15px;
  color: var(--ces-accent);
}
.ces-inline .ces-track {
  inset: 4px 0; border-radius: 999px;
  /* No track colour of its own: the toned stops show only their particle
     field (see the ::before rules below), and Off shows a bare hairline so
     the control still reads as a slider. */
  background: transparent;
  box-shadow: inset 0 0 0 1px var(--ces-track);
}
.ces-inline .ces-fill { border-radius: 999px; }
.ces-inline .ces-ticks { inset: 0 calc(1px + var(--ces-thumb-w) * 0.5); }
.ces-inline .ces-tick { width: 5px; height: 5px; }
.ces-inline .ces-tick:last-child { background: var(--ces-tick); }
/* Ultracode wash inherits the pill radius so the pixel field never shows
   square corners inside the rounded track. */
.ces-inline .ces-track[data-field]::before { border-radius: 999px; }
/* Belt and braces: a hidden native row must never reappear through an
   explicit display declaration in its own stylesheet. */
[hidden][aria-hidden="true"][data-ces-hidden] { display: none !important; }
@keyframes ces-panel-in {
  from { opacity: 0; transform: translateY(3px); }
  to { opacity: 1; transform: translateY(0); }
}
@keyframes ces-panel-out {
  from { opacity: 1; transform: translateY(0); }
  to { opacity: 0; transform: translateY(2px); }
}

.ces-header { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; min-height: 20px; }
.ces-title { display: flex; align-items: baseline; gap: 6px; color: var(--dsw-alias-label-secondary); font-weight: 500; letter-spacing: -0.01em; }
.ces-tip { position: relative; display: flex; align-items: center; color: var(--dsw-alias-label-tertiary); }
.ces-tip:hover .ces-tooltip, .ces-tip:focus-within .ces-tooltip { opacity: 1; visibility: visible; transform: translateY(0); }
.ces-tooltip {
  position: absolute; right: 0; top: calc(100% + 6px); z-index: 4;
  width: min(240px, calc(100vw - 48px)); padding: 6px 8px;
  border-radius: 8px; border: 1px solid var(--dsw-alias-border-l1);
  background: var(--dsw-alias-tooltip-bg, #34312f); color: var(--dsw-alias-tooltip-label, #fff);
  font-size: 12px; line-height: 17px; font-weight: 450; text-wrap: pretty;
  opacity: 0; visibility: hidden; transform: translateY(-2px);
  transition: opacity 120ms ease-in, transform 120ms ease-in, visibility 120ms;
}

.ces-axis { display: flex; justify-content: space-between; margin-top: 14px; color: var(--dsw-alias-label-tertiary); font-size: 12px; line-height: 16px; letter-spacing: -0.01em; }

.ces-stage { position: relative; display: inline-block; min-width: 0; height: 20px; overflow: visible; }
.ces-stage span {
  position: absolute; top: 0; left: 0; white-space: nowrap; line-height: 20px;
  transition: opacity 180ms cubic-bezier(0.2,0,0,1), transform 180ms cubic-bezier(0.2,0,0,1), filter 180ms cubic-bezier(0.2,0,0,1), color 180ms;
}
.ces-stage .ces-sizer { position: static; visibility: hidden; transition: none; }
.ces-stage .ces-in { transition-delay: 24ms; }
.ces-stage .ces-out { pointer-events: none; }
.ces-stage[data-moving] .ces-in { opacity: 0; transform: translateY(var(--ces-in-y, 3px)); filter: blur(2px); transition-duration: 0ms; transition-delay: 0ms; }
.ces-stage[data-moving] .ces-out { opacity: 0; transform: translateY(var(--ces-out-y, -3px)); filter: blur(2px); }
.ces-stage[data-ultra] .ces-in { color: var(--ces-accent); }

.ces-track-shell { position: relative; height: 44px; margin-top: 10px; }
.ces-track {
  position: absolute; inset: 9px 0; overflow: hidden;
  border-radius: 10px;
  background: var(--ces-track);
  box-shadow: inset 0 1px 1px rgba(70, 64, 59, 0.06);
  /* The frontier / rainbow overlays use mix-blend-mode (multiply). Without an
     isolated stacking context here, that blend reaches THROUGH the track
     into the native menu card's translucent material behind it — the card
     turned see-through (background text showed through the whole card) on
     the blue / green / rainbow stops, while Max, whose field has no blend,
     stayed solid. Isolating keeps the blend inside the track's own layers. */
  isolation: isolate;
}
body[data-ds-dark-theme] .ces-track { box-shadow: inset 0 1px 1px rgba(0, 0, 0, 0.35); }
.ces-track::before {
  content: ""; position: absolute; inset: 0; border-radius: inherit;
  background: linear-gradient(90deg, #eeebe9 0%, #ece9e7 18%, #e2dce3 32%, #d9d0df 48%, #d0c1da 68%, #cdbcd9 82%, #cbbad8 100%);
  opacity: 0; transition: opacity 600ms ease-in 1.3s;
}
body[data-ds-dark-theme] .ces-track::before {
  background: linear-gradient(90deg, #2b2733 0%, #332d40 20%, #3a3149 40%, #453a5c 62%, #4d4069 82%, #524472 100%);
}
/* Blue tone (the stop before Max): the same wash geometry, shifted from
   lavender to blue by dropping red and lifting blue in the gradient stops. */
.ces-track[data-field-tone="blue"]::before {
  background: linear-gradient(90deg, #e9ebef 0%, #e7eaf0 18%, #dde4ee 32%, #d2ddee 48%, #c9d5ef 68%, #c5d1f0 82%, #c3cff1 100%);
}
body[data-ds-dark-theme] .ces-track[data-field-tone="blue"]::before {
  background: linear-gradient(90deg, #272b33 0%, #2c3340 20%, #31394a 40%, #3a4560 62%, #435072 82%, #48557a 100%);
}
/* Green tone wash: same geometry, mint-tinted stops. */
.ces-track[data-field-tone="green"]::before {
  background: linear-gradient(90deg, #e9eeeb 0%, #e7efe9 18%, #dcece2 32%, #d1e9db 48%, #c8e6d5 68%, #c4e5d2 82%, #c2e4d0 100%);
}
body[data-ds-dark-theme] .ces-track[data-field-tone="green"]::before {
  background: linear-gradient(90deg, #27312d 0%, #2c3833 20%, #31443a 40%, #3a5547 62%, #436757 82%, #48705f 100%);
}
/* The violet wash follows the sweep instead of racing it: it fades in only
   once the pixel front has nearly reached the left edge. */
.ces-track[data-field]::before { opacity: 1; }
/* Inline (the only live mode): NO wash on any stop. The toned stops show
   their particle field alone, so the track is just the particles on the
   card; Off, which has no field, shows the hairline set on .ces-track.
   This supersedes the per-tone gradients above and the old violet track
   tint (which existed only to hide the wash/canvas seam). */
.ces-inline .ces-track::before,
.ces-inline .ces-track[data-field]::before,
.ces-inline .ces-track[data-field-tone="violet"]::before { display: none; }
.ces-inline .ces-track[data-field-tone="violet"],
body[data-ds-dark-theme] .ces-inline .ces-track[data-field-tone="violet"] { background: transparent; }
/* Max fills the whole track, so its wash has nothing to "wait for" after the
   sweep: drop the 1.3s-delayed fade-in that the other tones use to let the
   frontier arrive first. During that window the wash was semi-transparent
   and the neutral track showed through at the left end (the thumb hides the
   right), which read as a square left end next to a round right end. */
/* Edge shape: Max fills the track, so BOTH its ends are track ends and
   must look alike. The reference is the track's own left end — square
   particles butting against the container, which then trims everything
   to its pill. The canvas clip therefore rounds NOTHING; the container's
   overflow does the final symmetric trim. The clip stays on the canvas
   only because a composited layer must bound itself.
   It ALSO tracks the thumb on the right, like the blue/green clips: at
   the Max stop progress is 1 and the cut is zero (field fills the track),
   but the moment the thumb leaves Max the field contracts with it. Without
   this the field sat full until displayValue crossed 3.5 (the rounding
   threshold) — a half-stop of dead travel where Max looked stuck while
   High/Low, whose clips follow the thumb, visibly reacted at once. */
.ces-track[data-field-tone="violet"]::before { transition: none; }
.ces-track[data-field-tone="violet"] .ces-canvas {
  clip-path: inset(0 calc((1 - var(--ces-progress, 0)) * 100%) 0 0);
}
.ces-track[data-field][data-revealing]::before { opacity: 0; transition: none; }
.ces-fill {
  position: absolute; top: 0; bottom: 0; left: 1px; z-index: 0;
  width: calc((100% - 2px - var(--ces-thumb-w)) * var(--ces-progress, 0) + var(--ces-thumb-w) * 0.5);
  border-radius: 9px 0 0 9px;
  background: var(--ces-fill);
  pointer-events: none;
  transition: opacity 200ms cubic-bezier(0.2, 0, 0, 1);
}
.ces-track[data-field] .ces-fill { opacity: 0; }
.ces-canvas {
  position: absolute; inset: 0; z-index: 1; width: 100%; height: 100%;
  pointer-events: none; opacity: 0;
}
/* No opacity transition: the pixel field reveals itself progressively
   (first frame is empty by construction), so a fade-in would only show a
   half-drawn canvas and read as a glitch. */
.ces-track[data-field][data-canvas] .ces-canvas { opacity: 1; }
/* (Violet canvas clip lives with the other violet edge rules above.) */
/* Blue tone: the frozen drawPixelField paints lavender; rotating the hue
   -38deg lands it on blue while keeping every per-cell lightness variation
   and the wave motion intact. Applied only to the canvas, so the thumb and
   the badge keep their own colours. */
.ces-track[data-field-tone="blue"] .ces-canvas { filter: hue-rotate(-38deg) saturate(1.15); }
/* Green tone (Low): same frozen field, hue rotated -100deg from lavender to
   green with a touch more saturation so it reads green and not teal. */
.ces-track[data-field-tone="green"] .ces-canvas { filter: hue-rotate(-100deg) saturate(1.25); }
/* Blue and green fields are clipped to the thumb: only the swept portion
   (left of the current progress) shows particles; the rest of the track
   stays plain. The draw routine keeps painting the full canvas — clip-path
   is pure compositing and follows the live --ces-progress the drag path
   writes every frame. */
.ces-track[data-field-tone="blue"] .ces-canvas,
.ces-track[data-field-tone="green"] .ces-canvas {
  clip-path: inset(0 calc((1 - var(--ces-progress, 0)) * 100%) 0 0 round 0 999px 999px 0);
}
/* The wash under the particles is NOT clipped: it spans the whole track on
   every toned stop, exactly like Max's violet wash. Only the particle layer
   is cut at the thumb. (With the wash cut too, the un-swept side showed the
   bare neutral track through the 72%/88%-fill particle seams, which read as
   a translucent card next to Max's solid one.) */
/* Frontier band: a narrow vertical strip sitting exactly on the clip edge
   (the thumb's centre), tinting the particles at the moving boundary.
   Positioned from the same live --ces-progress, so it tracks the thumb with
   no extra JS. Blend is multiply for the same reason as the rainbow overlay:
   on the now-washless track, only the particles may take the tint, never the
   transparent gaps between them. The tints are lifted (mint / pale mint) so
   the multiply lands on a vivid boundary rather than a dark one.
   Blue field: the boundary reads green. Green field: a brighter mint so the
   edge still separates from the green body behind it. */
.ces-track[data-field-tone="blue"]::after,
.ces-track[data-field-tone="green"]::after {
  content: ""; position: absolute; z-index: 1; top: 0; bottom: 0;
  left: calc((100% - var(--ces-thumb-w, 26px)) * var(--ces-progress, 0) + var(--ces-thumb-w, 26px) * 0.5);
  width: 18px; margin-left: -9px; pointer-events: none;
  mix-blend-mode: multiply;
  opacity: 1;
}
.ces-track[data-field-tone="blue"]::after {
  background: linear-gradient(90deg, rgba(110, 231, 183, 0) 0%, rgba(110, 231, 183, 0.85) 50%, rgba(110, 231, 183, 0) 100%);
}
.ces-track[data-field-tone="green"]::after {
  background: linear-gradient(90deg, rgba(167, 243, 208, 0) 0%, rgba(167, 243, 208, 0.95) 50%, rgba(167, 243, 208, 0) 100%);
}
/* Rainbow tone (Auto): shown to the RIGHT of the thumb — the un-swept side,
   where the adapter will pick. Three compositing layers, no JS beyond the
   one --ces-progress the drag path already writes:
   1. canvas clip-path is mirrored (left inset = progress) so particles show
      from the thumb to the right end;
   2. ::before (a soft rainbow wash) is hidden in inline mode — no track
      colour, particles only, like every other stop;
   3. ::after is a full-height rainbow gradient over the thumb-to-right
      region with mix-blend-mode: multiply — being multiplicative it tints
      only the particles (transparent gaps stay transparent) and multiplies
      each particle's lightness by its x-position's hue, so the mosaic
      texture survives and reads as a rainbow. A thin mint edge marks the
      moving frontier (the thumb). */
.ces-track[data-field-tone="rainbow"] .ces-canvas {
  clip-path: inset(0 0 0 calc(var(--ces-progress, 0) * 100%) round 999px 0 0 999px);
}
/* Rainbow wash under the particles, matched to the blue/green washes: the
   light set runs S 14%→40% at L 91–93% (their range is S 13–16%→39–62% at
   L 79–93%), the dark set S 18–22% at L 17–25% like the violet dark wash.
   Same eight hue stations as the overlay so the wash and the blend agree. */
.ces-track[data-field-tone="rainbow"]::before {
  background: linear-gradient(90deg,
    hsl(0 14% 92%) 0%, hsl(45 20% 92%) 14%, hsl(95 22% 91%) 28%, hsl(165 26% 91%) 42%,
    hsl(205 30% 92%) 58%, hsl(255 30% 93%) 74%, hsl(305 24% 93%) 88%, hsl(340 18% 93%) 100%);
}
body[data-ds-dark-theme] .ces-track[data-field-tone="rainbow"]::before {
  background: linear-gradient(90deg,
    hsl(0 20% 22%) 0%, hsl(45 20% 22%) 14%, hsl(95 18% 20%) 28%, hsl(165 18% 19%) 42%,
    hsl(205 20% 21%) 58%, hsl(255 22% 24%) 74%, hsl(305 22% 24%) 88%, hsl(340 20% 23%) 100%);
}
.ces-track[data-field-tone="rainbow"]::after {
  /* Box = the whole track, i.e. the SAME box as the canvas, so the grid
     mask below lines up cell-for-cell with what drawPixelField painted.
     (An earlier cut sized this box from the thumb to the right end; a mask
     is positioned relative to its own box, so that would have slid the
     grid.) The thumb-to-right extent is now expressed by the mask instead. */
  content: ""; position: absolute; z-index: 1; inset: 0; pointer-events: none;
  /* Blend: MULTIPLY, not color. With the wash gone the backdrop under this
     overlay is the bare (transparent) track wherever there is no particle,
     and a non-separable blend like color still paints its own hue at full
     alpha on a transparent backdrop — the rainbow stain that stayed on the
     track at Auto. Multiply is a multiplicative mode: its result is
     transparent wherever the backdrop is.
     Saturation: each stop is a PURE hue (S 100%, L 50%), not a pastel — a
     pastel times the muted violet particles reads as one purple. L 50%,
     NOT 100%: hsl(H 100% 100%) is white, and white times the particle is
     just the particle.
    Hues: the three effort levels below Default, in order - Low, High,
    Max - from the level-text palette (green 2e9e6b = hue 153, blue 3b6fe0
    = 221, violet 7a5fc0 = 257). Each gets exactly one third of the cycle
    (stops at 0, 33.3, 66.7, 100), no hold segment, so the three read as
    equal bodies. First and last stop match, or the scroll (one full
    period) would show a seam every cycle.
    Saturation is deliberately NOT the palette's 43-73%: multiply is a
    per-channel product, and at low saturation all three channels carry
    weight, so the tint over the pale violet particles collapses toward
    one purple and the three levels stop being tellable apart (seen at
    S 80-90 in an earlier cut). 70% with lightness lifted to 62% keeps the
    hues legible while reading as mid, not neon; the higher L pays back
    the darkening multiply costs. */
  background: linear-gradient(90deg,
    hsl(153 70% 62%) 0%, hsl(221 70% 62%) 33.333%, hsl(257 70% 62%) 66.667%,
    hsl(153 70% 62%) 100%);
  /* Flow: the band is painted twice as wide as its box and slides left by
     one full cycle every 6s (linear, endless). Off for reduced motion. */
  background-size: 200% 100%;
  animation: ces-rainbow-flow 6s linear infinite;
  mix-blend-mode: multiply;
  opacity: 1;
  /* Only the CELLS take the tint. drawPixelField paints a translucent
     lavender wash that fills the track edge to edge underneath its grid,
     and the cells themselves are only partly opaque — so multiply alone
     coloured the wash too, and the right of the thumb read as one smooth
     rainbow band with no mosaic in it. Two masks, intersected:
       1. --ces-grid-mask: a black-on-transparent image of the cell grid,
          generated by the sizing effect from the SAME geometry the painter
          uses (rows, cell, block, inset, corner radius), so it registers
          with the painted cells exactly; the gaps between cells are
          transparent and stay untinted.
       2. a hard-edged linear gradient that is transparent up to the thumb's
          centre and opaque to its right — the Auto field shows on the
          un-swept side only.
     clip-path bounds the composited layer and rounds the live (left) edge. */
  mask-image: var(--ces-grid-mask, linear-gradient(90deg, #000 0 0)),
    linear-gradient(90deg,
      transparent 0,
      transparent calc((100% - var(--ces-thumb-w, 26px)) * var(--ces-progress, 0) + var(--ces-thumb-w, 26px) * 0.5),
      #000 calc((100% - var(--ces-thumb-w, 26px)) * var(--ces-progress, 0) + var(--ces-thumb-w, 26px) * 0.5));
  mask-size: 100% 100%, 100% 100%;
  mask-position: 0 0, 0 0;
  mask-composite: intersect;
  clip-path: inset(0 0 0 calc(var(--ces-progress, 0) * 100%) round 999px 0 0 999px);
}
@keyframes ces-rainbow-flow {
  from { background-position: 0% 0; }
  to { background-position: -200% 0; }
}
/* Dark theme: the particles themselves are dim (body L 20–24%), so a 50%
   lightness overlay multiplies down to near black. Lift the band so the
   product stays legible; same hue thirds and 70% saturation as the light
   theme, lightness raised to 74%. The background shorthand
   resets background-size, so it is restated here or the scroll would paint
   a 100%-wide (non-repeating) band and the flow would jump. */
body[data-ds-dark-theme] .ces-track[data-field-tone="rainbow"]::after {
  background: linear-gradient(90deg,
    hsl(153 70% 74%) 0%, hsl(221 70% 74%) 33.333%, hsl(257 70% 74%) 66.667%,
    hsl(153 70% 74%) 100%);
  background-size: 200% 100%;
}
@media (prefers-reduced-motion: reduce) {
  .ces-track[data-field-tone="rainbow"]::after { animation: none; }
}
.ces-ticks {
  position: absolute; z-index: 2; inset: 0 calc(1px + var(--ces-thumb-w) * 0.5);
  display: flex; align-items: center; justify-content: space-between; pointer-events: none;
}
.ces-tick { width: 4px; height: 4px; border-radius: 999px; background: var(--ces-tick); opacity: 0.82; transition: opacity 180ms cubic-bezier(0.2,0,0,1); }
.ces-tick:last-child { background: var(--ces-accent); opacity: 1; }
.ces-track[data-field] .ces-ticks { opacity: 0; }

.ces-range {
  position: absolute; z-index: 3; inset: 0 1px; width: calc(100% - 2px); height: 100%;
  margin: 0; appearance: none; -webkit-appearance: none;
  border: 0; outline: 0; background: transparent;
  cursor: ew-resize; touch-action: none;
}
.ces-range::-webkit-slider-runnable-track { height: var(--ces-thumb-h); border: 0; background: transparent; }
.ces-range::-webkit-slider-thumb {
  width: var(--ces-thumb-w); height: var(--ces-thumb-h); margin-top: 0;
  appearance: none; -webkit-appearance: none;
  border: 1px solid var(--ces-thumb-border);
  border-radius: 8px;
  background: var(--ces-thumb);
  box-shadow: 0 1px 2px rgba(62, 56, 50, 0.1), 0 4px 10px rgba(62, 56, 50, 0.08);
  cursor: ew-resize;
  transition: transform 150ms ease-out;
}
.ces-range:active::-webkit-slider-thumb { transform: scale(0.96); }
.ces-range:focus-visible::-webkit-slider-thumb {
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--ces-accent) 30%, transparent), 0 1px 2px rgba(62, 56, 50, 0.1), 0 4px 10px rgba(62, 56, 50, 0.08);
}
.ces-range::-moz-range-track { height: var(--ces-thumb-h); border: 0; background: transparent; }
.ces-range::-moz-range-thumb {
  width: var(--ces-thumb-w); height: var(--ces-thumb-h);
  border: 1px solid var(--ces-thumb-border); border-radius: 8px;
  background: var(--ces-thumb);
  box-shadow: 0 1px 2px rgba(62, 56, 50, 0.1), 0 4px 10px rgba(62, 56, 50, 0.08);
  cursor: ew-resize; transition: transform 150ms ease-out;
}
.ces-range:disabled { cursor: default; }

.ces-error {
  display: flex; align-items: flex-start; gap: 6px;
  margin-top: 10px; padding: 6px 8px;
  border-radius: var(--dsw-radius-md, 8px);
  background: var(--dsw-alias-interactive-bg-hover-danger, rgba(200, 60, 60, 0.12));
  color: var(--dsw-alias-state-error-primary);
  font-size: 11px; line-height: 16px;
}

@media (prefers-reduced-motion: reduce) {
  .ces-panel { animation: none; }
  .ces-stage span, .ces-track::before, .ces-fill, .ces-canvas, .ces-tick,
  .ces-range::-webkit-slider-thumb, .ces-range::-moz-range-thumb,
  .ces-chevron, .ces-chip { transition-duration: 0.001ms; }
  .ces-track[data-field] .ces-canvas { opacity: 0; }
}
`;

    // --- Components ----------------------------------------------------------

    const noopSubscribe = () => () => {};

    // Diagnostics shared between the slider and the menu injector (see the
    // observer callback): records what the slider was doing at the instant
    // the native menu card disappeared, so a stray close can be traced.
    const dragState = { pointerDown: false };
    let lastPointerUpAt = 0;
    let lastCommitState = 'none';
    const describeElement = (node) => {
      if (!(node instanceof Element)) return node === null ? 'null' : String(node);
      const cls = node.className instanceof SVGAnimatedString ? node.className.baseVal : node.className;
      return `${node.tagName.toLowerCase()}${node.id ? '#' + node.id : ''}${typeof cls === 'string' && cls ? '.' + cls.split(/\s+/).slice(0, 3).join('.') : ''}`;
    };

    // Live badge slot (the span inside the native 「模型」 row). The injector
    // plants/replants it; the inline slider portals its level badge into
    // whatever node this currently holds and re-renders when it changes.
    const badgeSlot = { current: null, listeners: new Set() };
    const setBadgeSlot = (node) => {
      if (badgeSlot.current === node) return;
      badgeSlot.current = node;
      for (const listener of badgeSlot.listeners) listener();
    };
    function useBadgeSlot() {
      return useSyncExternalStore(
        (fn) => { badgeSlot.listeners.add(fn); return () => { badgeSlot.listeners.delete(fn); }; },
        () => badgeSlot.current,
        () => null,
      );
    }

    /** Direction-aware blur-crossfade level label (researched 3px/180ms swap). */
    function LevelLabel({ label, forward, ultra, longest, tone = null }) {
      const [current, setCurrent] = useState(label);
      const [outgoing, setOutgoing] = useState(null);
      const [moving, setMoving] = useState(false);
      const currentRef = useRef(label);
      useEffect(() => {
        if (label === currentRef.current) return undefined;
        setOutgoing(currentRef.current);
        currentRef.current = label;
        setCurrent(label);
        setMoving(true);
        const timer = window.setTimeout(() => {
          setOutgoing(null);
          setMoving(false);
        }, LABEL_SWAP_MS + 20);
        return () => window.clearTimeout(timer);
      }, [label]);
      return h('span', {
        className: 'ces-stage',
        'data-moving': moving ? '' : undefined,
        'data-ultra': ultra ? '' : undefined,
        'data-tone': tone === null ? undefined : tone,
        style: { '--ces-in-y': forward ? '3px' : '-3px', '--ces-out-y': forward ? '-3px' : '3px' },
      },
      h('span', { className: 'ces-sizer', 'aria-hidden': true }, longest),
      outgoing !== null && h('span', { className: 'ces-out', 'aria-hidden': true }, outgoing),
      h('span', { className: 'ces-in', 'aria-live': 'polite' }, current),
      );
    }

    /**
     * The effort slider.
     * @param {object} props - inject face (`directory` store, `load`, `select`)
     *   plus the bound locale `t`.
     * @param {boolean} [props.inline] - render the slider body only, without
     *   the chip and popover shell, for mounting inside the native model menu's
     *   effort pane (the menu owns open/close, Escape and focus).
     */
    function EffortChip({ directory, load, select, t, tNative, inline = false }) {
      const state = useSyncExternalStore(
        directory === null ? noopSubscribe : (fn) => directory.subscribe(fn),
        directory === null ? () => null : () => directory.getSnapshot(),
      );
      const id = useId();
      const anchorVar = `--ces-anchor-${id.replaceAll(':', '')}`;
      // Inline only: the live node inside the native 「模型」 row that hosts
      // the level badge. Harmless (always null) in standalone mode.
      const badgeSlotNode = useBadgeSlot();
      const rootRef = useRef(null);
      const closeTimerRef = useRef(0);

      const [open, setOpen] = useState(false);
      // Inline mode is always "open": the host menu decides visibility.
      const active = inline || open;
      const [closing, setClosing] = useState(false);
      const [dragValue, setDragValue] = useState(null);
      // True for the whole press-to-release window (not just while moving):
      // gates the canvas loop during a drag.
      const [dragging, setDragging] = useState(false);
      const [error, setError] = useState(null);
      const [busy, setBusyState] = useState(false);
      const displayIndexRef = useRef(0);
      // busy as a ref too: the blur-to-close timeout must read the current
      // flag, not the one captured when the handler was created.
      const busyRef = useRef(false);
      const commitLockedRef = useRef(false);
      const setBusy = useCallback((value) => {
        busyRef.current = value;
        setBusyState(value);
      }, []);

      const draggingRef = useRef(false);
      const springRef = useRef(0);
      const samplesRef = useRef([]);
      const canvasRef = useRef(null);
      const trackRef = useRef(null);
      const canvasFrameRef = useRef(0);
      const lastCanvasFrameRef = useRef(0);
      const ultraSinceRef = useRef(0);
      const wasFieldToneRef = useRef(null);
      // Seeded 0; the layout effect below syncs it to the real value after
      // every render, before any pointer/spring handler can read it.
      const displayValueRef = useRef(0);

      useEffect(() => {
        if (load !== undefined) load();
      }, [load]);

      // Route + reasoning catalog.
      const route = state === null ? null : state.current;
      const modelInfo = useMemo(() => {
        if (state === null || route === null) return null;
        for (const group of state.groups) {
          if (group.id !== route.provider) continue;
          const model = group.models.find((entry) => entry.id === route.model);
          if (model !== undefined) return model;
        }
        return null;
      }, [state, route]);
      const reasoning = modelInfo === null ? undefined : modelInfo.reasoning;
      const efforts = reasoning === undefined ? [] : reasoning.efforts;
      const defaultEffort = reasoning === undefined ? undefined : reasoning.defaultEffort;

      // Stop order, left to right: off, auto, low, high, Max. `off` leads the
      // scale (it is the explicit "no thinking" choice); `auto` — present only
      // when the catalog declares no default — sits second, so the rainbow
      // field to its right still covers the "model decides" range. Identified
      // by id, never by catalog position, so an efforts list in any order
      // lays out the same way.
      const stops = useMemo(() => {
        const list = [];
        const off = efforts.find((effort) => effort.id === 'off');
        if (off !== undefined) list.push({ id: off.id, name: off.name });
        if (reasoning !== undefined && defaultEffort === undefined) {
          // Same word the composer pill uses (ModelSelect: t('effort.providerDefault')),
          // read from the native dictionary so the two stay one string. A bind
          // that missed (namespace not registered) returns the key itself —
          // fall back to the plugin's own label then.
          const nativeName = typeof tNative === 'function' ? tNative('effort.providerDefault') : undefined;
          const autoName = nativeName !== undefined && nativeName !== 'effort.providerDefault'
            ? nativeName
            : t('effort.auto');
          list.push({ id: undefined, name: autoName });
        }
        for (const effort of efforts) {
          if (effort.id === 'off') continue;
          list.push({ id: effort.id, name: effort.name });
        }
        return list;
      }, [reasoning, defaultEffort, efforts, t, tNative]);

      const effectiveEffort = route === null ? undefined : (
        route.reasoningEffort !== undefined ? route.reasoningEffort : defaultEffort
      );
      const committedIndex = useMemo(() => {
        const found = stops.findIndex((stop) => stop.id === effectiveEffort);
        return found === -1 ? 0 : found;
      }, [stops, effectiveEffort]);

      // "Settled but not yet confirmed" value. The spring ends BEFORE the
      // store echoes the new selection back (an RPC round-trip), so dropping
      // the drag value at spring end would make the thumb jump back to the
      // OLD committed stop for a frame or two — the visible flicker. Instead
      // the spring hands its final position to holdValue; an effect clears it
      // once committedIndex catches up (or the selection failed and the
      // store stayed put, in which case the thumb eases back honestly).
      const [holdValue, setHoldValue] = useState(null);
      useEffect(() => {
        if (holdValue === null) return;
        if (Math.round(holdValue) === committedIndex) setHoldValue(null);
      }, [holdValue, committedIndex]);
      // If the commit failed, the store never catches up: release the hold
      // after the busy flag clears so the thumb returns to the real stop.
      useEffect(() => {
        if (!busy && holdValue !== null && Math.round(holdValue) !== committedIndex && error !== null) {
          setHoldValue(null);
        }
      }, [busy, holdValue, committedIndex, error]);

      const displayValue = dragValue === null
        ? (holdValue === null ? committedIndex : holdValue)
        : dragValue;
      const displayIndex = clamp(Math.round(displayValue), 0, Math.max(stops.length - 1, 0));
      const currentStop = stops[displayIndex];
      // Pixel-field tones, keyed by distance from the END of the scale so
      // they stay attached to the same levels whatever the model's effort
      // count: last stop = violet Ultracode, one below = blue, two below =
      // green. The first stop (Off / the resting level) never gets a field,
      // via the distance rule, so a short scale simply has fewer tones.
      // Auto is the one exception: it is the synthetic stop with no id
      // (`reasoningEffort` is omitted, the adapter picks), present only when
      // the catalog declares no default. It gets a rainbow field that shows
      // to the RIGHT of the thumb (the un-swept side — "the model decides").
      // Identified by `id === undefined`, never by index, so a scale without
      // Auto keeps its first stop (Off) field-less. `isUltra` stays the
      // Max-only semantic (badge tint, data-ultra); `fieldTone !== null`
      // drives the canvas lifecycle and `data-field`.
      const fromEnd = stops.length - 1 - displayIndex;
      const isAutoStop = currentStop !== undefined && currentStop.id === undefined;
      const fieldTone = toneOf(stops, displayIndex);
      const isUltra = fromEnd === 0 && stops.length >= 2 && !isAutoStop;
      const progress = stops.length > 1 ? displayValue / (stops.length - 1) : 0;
      const longest = useMemo(
        () => stops.reduce((best, stop) => (stop.name.length > best.length ? stop.name : best), ''),
        [stops],
      );
      const pending = state !== null && state.pending !== null;
      const noStops = stops.length < 2;
      // `pending`/`busy` deliberately do NOT disable the range: flipping the
      // native `disabled` attribute mid-interaction makes the browser drop
      // pointer capture, blur the control and restyle it, and rebuilds every
      // handler that keys on it — felt as a hitch exactly on the first stop
      // that commits (Low; Off is the resting value and commits nothing).
      // Re-entrant commits are safe: directory.select keeps a generation
      // counter, so a newer selection supersedes an in-flight one.
      const disabled = directory === null || route === null || noStops;
      // In-flight commit guard lives in commitLockedRef (see commit).

      const openPanel = useCallback(() => {
        if (disabled || stops.length < 2) return;
        window.clearTimeout(closeTimerRef.current);
        closeTimerRef.current = 0;
        setClosing(false);
        setError(null);
        setDragValue(null);
        setOpen(true);
      }, [disabled, stops.length]);

      const closePanel = useCallback(() => {
        if (!open) return;
        window.clearTimeout(closeTimerRef.current);
        setClosing(true);
        setOpen(false);
        closeTimerRef.current = window.setTimeout(() => {
          setClosing(false);
        }, prefersReducedMotion() ? 0 : 120);
      }, [open]);

      // Sync the refs from state ONLY when no drag / spring owns the value.
      // During a drag the DOM path writes displayValueRef on every input event
      // (ahead of any render); if this effect also copied the state back it
      // would yank the ref to the stale crossing-time value on every render
      // and the next frame would read a position the pointer already left.
      useLayoutEffect(() => {
        if (dragValue !== null) return;
        displayValueRef.current = displayValue;
        displayIndexRef.current = displayIndex;
      }, [dragValue, displayValue, displayIndex]);

      // Commit one stop through the shared directory (same call as the native seat).
      // Inline: the native menu closes on blur (focus leaving its card). A
      // commit flips the native `busy` flag, which disables the hidden native
      // rows; if focus sat on one of them the browser drops it to <body> and
      // the menu closes mid-drag. Keep focus pinned to our range across the
      // commit so the card stays open.
      const keepFocusInRange = useCallback(() => {
        if (!inline) return;
        const range = rootRef.current?.querySelector('input.ces-range');
        if (range instanceof HTMLInputElement && document.activeElement !== range) {
          range.focus({ preventScroll: true });
        }
      }, [inline]);

      // Drag / spring write path: the fill width lives in one CSS variable on
      // the track, so the pointer-rate updates can go straight to the DOM
      // without a React render (see onRangeInput). Shared by the spring below.
      const writeProgress = useCallback((value) => {
        const track = trackRef.current;
        if (track !== null) track.style.setProperty('--ces-progress', String(progressOf(value, stops.length)));
      }, [stops.length]);
      // One pending paint for the drag path (see applyDragValue). Writes both
      // faces of the thumb once per frame: the fill via the CSS variable and
      // the native thumb via input.value (its only driver). Since the native
      // drag never starts (preventDefault on press), this is the single
      // thumb movement per frame — no browser-vs-magnet competition.
      const rangeRef = useRef(null);
      const inputFrameRef = useRef(0);
      const flushInput = useCallback(() => {
        inputFrameRef.current = 0;
        const value = displayValueRef.current;
        writeProgress(value);
        const range = rangeRef.current;
        if (range !== null && range.value !== String(value)) range.value = String(value);
      }, [writeProgress]);
      useEffect(() => () => {
        if (inputFrameRef.current !== 0) window.cancelAnimationFrame(inputFrameRef.current);
      }, []);

      const commit = useCallback((stopIndex) => {
        const stop = stops[stopIndex];
        if (stop === undefined || route === null) return;
        if (stop.id === effectiveEffort) return;
        // One in-flight selection at a time; the next release after the store
        // settles commits normally. (The range stays enabled meanwhile.)
        if (commitLockedRef.current) return;
        commitLockedRef.current = true;
        keepFocusInRange();
        lastCommitState = 'pending';
        setBusy(true);
        setError(null);
        Promise.resolve(
          select({
            provider: route.provider,
            model: route.model,
            ...(stop.id === undefined ? {} : { reasoningEffort: stop.id }),
          }),
        ).then((result) => {
          commitLockedRef.current = false;
          setBusy(false);
          keepFocusInRange();
          lastCommitState = result !== undefined && result !== null && !result.ok ? 'error' : 'ok';
          if (result !== undefined && result !== null && !result.ok) {
            const detail = result.error === undefined
              ? 'unknown'
              : `${result.error.code}: ${result.error.message}`;
            setError(result.error !== undefined && result.error.code === 'session/writer-held'
              ? t('error.writerHeld')
              : t('error.select', { message: detail }));
          } else {
            // Remember the pick for this model so switching back restores it.
            rememberEffort(route.provider, route.model, stop.id);
          }
        }).catch(() => { commitLockedRef.current = false; setBusy(false); keepFocusInRange(); });
      }, [stops, route, effectiveEffort, select, t, keepFocusInRange]);

      // (Per-model effort memory is restored by the always-mounted FaceProbe,
      // so a model switch restores without the menu having to be opened.
      // The slider only WRITES the memory, in commit.)

      // Spring to the nearest stop (stiffness/damping from the reference port).
      const springTo = useCallback((target, initialVelocity) => {
        window.cancelAnimationFrame(springRef.current);
        springRef.current = 0;
        if (prefersReducedMotion() || Math.abs(target - displayValueRef.current) < 0.001) {
          // Hand straight to holdValue (not null): see the holdValue note.
          setDragValue(null);
          setHoldValue(target);
          commit(target);
          return;
        }
        let position = displayValueRef.current;
        let velocity = initialVelocity;
        let previous = performance.now();
        const step = (time) => {
          const delta = Math.min((time - previous) / 1000, 0.032);
          previous = time;
          const acceleration = -SPRING_STIFFNESS * (position - target) - SPRING_DAMPING * velocity;
          velocity += acceleration * delta;
          position = clamp(position + velocity * delta, 0, stops.length - 1);
          // Same DOM-first path as the drag: paint now, re-render only on a
          // stop crossing so the badge / ultra state follow the thumb.
          displayValueRef.current = position;
          writeProgress(position);
          const index = clamp(Math.round(position), 0, stops.length - 1);
          if (index !== displayIndexRef.current) {
            // Same advance-on-crossing as the drag path: one re-render per
            // crossing, not per frame of the spring.
            displayIndexRef.current = index;
            setDragValue(position);
          }
          if (Math.abs(position - target) < 0.001 && Math.abs(velocity) < 0.01) {
            springRef.current = 0;
            // Keep the thumb where the spring left it until the store
            // confirms; clearing to null here is what caused the flicker.
            setDragValue(null);
            setHoldValue(target);
            commit(target);
            return;
          }
          springRef.current = window.requestAnimationFrame(step);
        };
        springRef.current = window.requestAnimationFrame(step);
      }, [stops.length, commit, writeProgress]);

      // Inline: the native menu closes on any document `mousedown` whose
      // target is outside its trigger and (apparently) outside its card ref.
      // Our slider lives inside the card DOM, but the native ref check does
      // not see it (it returns undefined, not true, for our subtree), so a
      // drag would close the menu on press. Swallow mousedown/pointerdown at
      // the host so they never reach the native document listener; genuine
      // outside clicks are unaffected. React's synthetic stopPropagation
      // stops the native event too, since React listens on its own root.
      const onMouseDown = useCallback((event) => {
        if (!inline) return;
        event.stopPropagation();
      }, [inline]);

      // Inline: React's onBlur on the native root never sees focus events
      // from our separate React root, so "leave the card to close" would not
      // happen for the slider. Implement it ourselves: when focus leaves our
      // range toward something outside the menu card, hand the card an Escape
      // so the native handler closes it (and restores trigger focus).
      const onFocusOut = useCallback((event) => {
        if (!inline) return;
        const card = event.currentTarget.closest('[role="menu"]');
        const next = event.relatedTarget;
        if (next instanceof Node && card !== null && card.contains(next)) return;
        if (card === null) return;
        // Let the current focusout finish before re-entering the native tree.
        window.setTimeout(() => {
          const active = document.activeElement;
          if (active instanceof Node && card.contains(active)) return;
          // A commit disables the range for the RPC round-trip; the browser
          // blurs a disabled control, which is NOT the user leaving. The
          // commit's keepFocusInRange puts focus back when it re-enables.
          if (busyRef.current || dragState.pointerDown) return;
          card.dispatchEvent(new KeyboardEvent('keydown', {
            key: 'Escape', code: 'Escape', bubbles: true, cancelable: true,
          }));
        }, 0);
      }, [inline]);

      // --- Pointer-driven drag -------------------------------------------------
      // The native <input type=range> does two things that fight a smooth
      // thumb: (1) a press on the track TELEPORTS the thumb to the pointer
      // before dragging, and (2) during the drag the browser keeps moving the
      // thumb from the pointer on its own while our magnet correction rewrites
      // input.value — two thumb positions per frame, read as stutter. We take
      // the pointer over instead: capture it on press, keep the thumb where it
      // is relative to the grab point, and drive position from pointermove
      // through the same DOM path as the keyboard. preventDefault on press
      // stops the browser's own drag from starting at all.
      const grabOffsetRef = useRef(0);   // pointer X − thumb centre X at press
      const pointerIdRef = useRef(null);

      // Magnet pull toward integer stops while dragging (reference behavior).
      const applyMagnet = useCallback((value) => {
        const nearest = Math.round(value);
        const delta = value - nearest;
        const distance = Math.abs(delta);
        if (distance < 0.001 || distance > MAGNET_RADIUS) return value;
        const t01 = 1 - distance / MAGNET_RADIUS;
        const strength = 0.68 + 0.42 * t01;
        return value - delta * strength * t01 * t01;
      }, []);

      const valueFromPointer = useCallback((clientX) => {
        const track = trackRef.current;
        if (track === null) return displayValueRef.current;
        const rect = track.getBoundingClientRect();
        const thumbW = inline ? 26 : 20;
        const usable = Math.max(rect.width - thumbW, 1);
        const centre = clientX - rect.left - thumbW * 0.5 - grabOffsetRef.current;
        return clamp((centre / usable) * (stops.length - 1), 0, stops.length - 1);
      }, [stops.length, inline]);

      // Shared by pointermove: the exact drag path onRangeInput used.
      const applyDragValue = useCallback((next) => {
        next = applyMagnet(next);
        displayValueRef.current = next;
        if (inputFrameRef.current === 0) inputFrameRef.current = window.requestAnimationFrame(flushInput);
        const index = clamp(Math.round(next), 0, stops.length - 1);
        if (index !== displayIndexRef.current) {
          displayIndexRef.current = index;
          setDragValue(next);
        }
      }, [applyMagnet, flushInput, stops.length]);

      const onPointerDown = useCallback((event) => {
        dragState.pointerDown = true;
        if (disabled) return;
        // Own the pointer: moves keep arriving even outside the input.
        if (event.pointerId !== undefined) {
          pointerIdRef.current = event.pointerId;
          try { event.currentTarget.setPointerCapture(event.pointerId); } catch { /* not supported */ }
        }
        // Stop the native range drag (its thumb teleport + own tracking).
        event.preventDefault();
        // preventDefault also cancels the focus-on-press; keep focus on the
        // range so blur-to-close and keyboard steps keep working.
        if (event.currentTarget instanceof HTMLInputElement) event.currentTarget.focus({ preventScroll: true });
        window.cancelAnimationFrame(springRef.current);
        springRef.current = 0;
        draggingRef.current = true;
        setDragging(true);
        // Where is the thumb now, in px? Keep the grab offset so a press on
        // the thumb does not re-centre it under the pointer.
        const track = trackRef.current;
        if (track !== null) {
          const rect = track.getBoundingClientRect();
          const thumbW = inline ? 26 : 20;
          const usable = Math.max(rect.width - thumbW, 1);
          const centre = rect.left + thumbW * 0.5 + usable * progressOf(displayValueRef.current, stops.length);
          const offset = event.clientX - centre;
          // Press on the track (outside the thumb): jump to the pointer.
          // Press on the thumb: keep the offset for the whole drag.
          if (Math.abs(offset) > thumbW * 0.5) {
            grabOffsetRef.current = 0;
            applyDragValue(valueFromPointer(event.clientX));
          } else {
            grabOffsetRef.current = offset;
          }
        }
        samplesRef.current = [{ time: performance.now(), value: displayValueRef.current }];
      }, [disabled, applyDragValue, valueFromPointer, stops.length, inline]);
      const onPointerMove = useCallback((event) => {
        if (!draggingRef.current) return;
        applyDragValue(valueFromPointer(event.clientX));
        const samples = samplesRef.current;
        const now = performance.now();
        samples.push({ time: now, value: displayValueRef.current });
        samplesRef.current = samples.filter((sample) => now - sample.time < 90).slice(-5);
      }, [applyDragValue, valueFromPointer]);

      const onPointerUp = useCallback((event) => {
        dragState.pointerDown = false;
        lastPointerUpAt = performance.now();
        if (pointerIdRef.current !== null && event !== undefined && event.pointerId === pointerIdRef.current) {
          // Release on the range itself (not event.currentTarget, which is the
          // document when this runs from the document-level fallback).
          const range = rangeRef.current;
          if (range !== null && range.hasPointerCapture(event.pointerId)) {
            try { range.releasePointerCapture(event.pointerId); } catch { /* already released */ }
          }
          pointerIdRef.current = null;
        }
        if (!draggingRef.current) return;
        draggingRef.current = false;
        setDragging(false);
        const value = displayValueRef.current;
        const target = clamp(Math.round(value), 0, stops.length - 1);
        let velocity = 0;
        const samples = samplesRef.current;
        if (samples.length >= 2) {
          const first = samples[0];
          const last = samples[samples.length - 1];
          const seconds = Math.max((last.time - first.time) / 1000, 0.016);
          velocity = clamp((last.value - first.value) / seconds, -8, 8);
        }
        samplesRef.current = [];
        keepFocusInRange();
        springTo(target, velocity);
      }, [stops.length, springTo, keepFocusInRange]);

      // Release must reach us no matter where the pointer ends up. Pointer
      // capture is the primary path, but it can silently fail (the try/catch
      // above) or be revoked by the browser (pointer leaves the window,
      // system gesture) — in which case a pointerup outside the card never
      // reached the range, draggingRef stayed true, and the thumb neither
      // snapped nor committed, so the field never switched. Register a
      // document-level fallback on press; it is removed on any release.
      const endDrag = useCallback((event) => {
        if (event !== undefined && event.pointerId !== undefined
          && pointerIdRef.current !== null && event.pointerId !== pointerIdRef.current) return;
        document.removeEventListener('pointerup', endDrag, true);
        document.removeEventListener('pointercancel', endDrag, true);
        onPointerUp(event);
      }, [onPointerUp]);

      useEffect(() => {
        if (!dragging) return undefined;
        document.addEventListener('pointerup', endDrag, true);
        document.addEventListener('pointercancel', endDrag, true);
        // Pointer released OUTSIDE the browser window emits nothing we can
        // hear; a blur (window switch) or the pointer leaving the document
        // means the drag is over as far as the user is concerned — settle at
        // the last position rather than leaving the thumb dangling.
        const abandon = () => endDrag(undefined);
        window.addEventListener('blur', abandon);
        document.addEventListener('pointerleave', abandon);
        return () => {
          document.removeEventListener('pointerup', endDrag, true);
          document.removeEventListener('pointercancel', endDrag, true);
          window.removeEventListener('blur', abandon);
          document.removeEventListener('pointerleave', abandon);
        };
      }, [dragging, endDrag]);

      // Keyboard `input` path (the pointer drag goes through applyDragValue
      // above): a range input fires `input` at pointer
      // rate (60-120Hz), and routing every sample through setState re-rendered
      // the whole chip — portal, track, label state machine — which is the
      // drag stutter. Instead write the fill width straight to the track's
      // CSS variable and only re-render when the rounded stop INDEX changes
      // (that is what the badge / ultra animation depend on), a few times
      // per drag instead of hundreds.
      const onRangeInput = useCallback((event) => {
        if (disabled) return;
        let next = Number.parseFloat(event.target.value);
        if (Number.isNaN(next)) return;
        if (draggingRef.current) {
          next = applyMagnet(next);
          // Only touch input.value when the magnet actually moved it: writing
          // it on every event forces a layout per event and fights the
          // browser's own thumb tracking.
          if (Math.abs(Number.parseFloat(event.target.value) - next) > 1e-4) event.target.value = String(next);
          const now = performance.now();
          const samples = samplesRef.current;
          samples.push({ time: now, value: next });
          samplesRef.current = samples.filter((sample) => now - sample.time < 90).slice(-5);
        }
        displayValueRef.current = next;
        // Coalesce the paint: many input events can land in one frame, but
        // the fill only needs the latest value once per frame.
        if (inputFrameRef.current === 0) inputFrameRef.current = window.requestAnimationFrame(flushInput);
        const index = clamp(Math.round(next), 0, stops.length - 1);
        if (index !== displayIndexRef.current) {
          // Advance the index ref here too, so the test above never re-fires
          // for the same crossing (that was one setState per event before).
          displayIndexRef.current = index;
          setDragValue(next);
        }
      }, [disabled, applyMagnet, writeProgress, flushInput, stops.length]);

      const onKeyDown = useCallback((event) => {
        // Inline: the native menu card handles Escape / Shift+Tab / arrows
        // through React's synthetic tree, which our separate root never
        // reaches. Keep our navigation keys from bubbling into the card's
        // delegated listener (it would move focus to the hidden native rows),
        // and re-dispatch Escape and Shift+Tab on the card so the native
        // handlers back out of the pane exactly as before.
        if (inline) {
          const card = event.currentTarget.closest('[role="menu"]');
          if (event.key === 'Escape' || (event.key === 'Tab' && event.shiftKey)) {
            event.preventDefault();
            event.stopPropagation();
            card?.dispatchEvent(new KeyboardEvent('keydown', {
              key: event.key, code: event.code, shiftKey: event.shiftKey,
              bubbles: true, cancelable: true,
            }));
            return;
          }
          if (event.key !== 'Tab') event.stopPropagation();
        }
        if (disabled) return;
        const index = clamp(Math.round(displayValueRef.current), 0, stops.length - 1);
        const targets = {
          ArrowLeft: index - 1,
          ArrowRight: index + 1,
          PageDown: index - 1,
          PageUp: index + 1,
          Home: 0,
          End: stops.length - 1,
        };
        if (!(event.key in targets)) return;
        event.preventDefault();
        const target = clamp(targets[event.key], 0, stops.length - 1);
        window.cancelAnimationFrame(springRef.current);
        springRef.current = 0;
        springTo(target, 0);
      }, [disabled, inline, stops.length, springTo]);

      // Outside click closes (panel is fixed-positioned but a DOM child of the root).
      useEffect(() => {
        if (!open) return undefined;
        const onDocumentPointerDown = (event) => {
          if (rootRef.current !== null && rootRef.current.contains(event.target)) return;
          closePanel();
        };
        document.addEventListener('pointerdown', onDocumentPointerDown, true);
        return () => document.removeEventListener('pointerdown', onDocumentPointerDown, true);
      }, [open, closePanel]);

      // Inline: when the native pane opens its focus logic targets the (now
      // hidden) native checked row. Take focus into the slider instead, so
      // arrow keys and Escape work immediately, without stealing focus on
      // later re-renders (only when nothing inside the menu card holds it).
      useEffect(() => {
        if (!inline) return undefined;
        const card = rootRef.current?.closest('[role="menu"]') ?? null;
        const card2 = card ?? rootRef.current;
        if (card2.contains(document.activeElement)) return undefined;
        const range = rootRef.current?.querySelector('input.ces-range');
        range?.focus({ preventScroll: true });
        return undefined;
      }, [inline]);

      useEffect(() => () => {
        window.clearTimeout(closeTimerRef.current);
        window.cancelAnimationFrame(springRef.current);
        window.cancelAnimationFrame(canvasFrameRef.current);
      }, []);

      // Ultracode reveal restarts only when the ultra stop is re-entered
      // (not when the popover reopens). Paint the very first frame
      // synchronously here so the canvas never shows an empty pass, and flag
      // the sweep so the violet wash waits for it to finish.
      const [revealing, setRevealing] = useState(false);
      // True only for the first field this MOUNT sees. The slider is mounted
      // fresh every time the menu opens (and re-mounted after a model pick
      // returns to the root pane), so "first on mount" is exactly "the card
      // just appeared with a toned stop already committed". Later field
      // appearances on the same mount — e.g. dragging Off -> Low — are user
      // actions and keep the full sweep.
      const sawFieldOnMountRef = useRef(false);
      useLayoutEffect(() => {
        if (fieldTone !== null && wasFieldToneRef.current !== fieldTone) {
          // The card pops in at once, so the field must too: start the
          // (frozen) sweep as already finished by back-dating startedAt past
          // REVEAL_MS — drawPixelField then paints the settled, full track on
          // its very first frame, with only the idle wave motion from there.
          const firstField = !sawFieldOnMountRef.current;
          sawFieldOnMountRef.current = true;
          wasFieldToneRef.current = fieldTone;
          const now = performance.now();
          ultraSinceRef.current = firstField ? now - REVEAL_MS - 1 : now;
          lastCanvasFrameRef.current = 0;
          setRevealing(!firstField && !prefersReducedMotion());
          if (canvasRef.current !== null) {
            drawPixelField(canvasRef.current, ultraSinceRef.current, now);
          }
        } else if (fieldTone === null && wasFieldToneRef.current !== null) {
          wasFieldToneRef.current = null;
          ultraSinceRef.current = 0;
          setRevealing(false);
        }
      }, [fieldTone]);

      useEffect(() => {
        if (!revealing) return undefined;
        const timer = window.setTimeout(() => setRevealing(false), REVEAL_MS + 60);
        return () => window.clearTimeout(timer);
      }, [revealing]);

      // Canvas sizing follows the track box. Sizing resets the bitmap, so
      // redraw immediately after a resize when a field is showing. The effect
      // keys on `active` only: re-running it on every tone change tore down
      // and rebuilt the ResizeObserver each time the thumb crossed a stop,
      // which landed on the same frame as the commit and read as a hitch.
      const fieldToneRef = useRef(null);
      useLayoutEffect(() => { fieldToneRef.current = fieldTone; }, [fieldTone]);
      useLayoutEffect(() => {
        const canvas = canvasRef.current;
        const track = trackRef.current;
        if (canvas === null || track === null) return undefined;
        const resize = () => {
          const rect = track.getBoundingClientRect();
          if (rect.width === 0 || rect.height === 0) return;
          const ratio = Math.min(window.devicePixelRatio || 1, 2);
          const width = Math.round(rect.width * ratio);
          const height = Math.round(rect.height * ratio);
          if (canvas.width !== width || canvas.height !== height) {
            canvas.width = width;
            canvas.height = height;
            canvas.style.width = `${rect.width}px`;
            canvas.style.height = `${rect.height}px`;
            if (fieldToneRef.current !== null) {
              drawPixelField(canvas, ultraSinceRef.current || performance.now(), performance.now());
            }
            publishMask();
          }
        };
        // Rainbow: publish a cell-grid mask that registers with the sized
        // bitmap, so the tint overlay colours cells only. The dark theme
        // draws wider cell seams (72% fill vs 88%), so the mask must follow
        // a theme switch too, not just a resize.
        const publishMask = () => {
          const w = canvas.width;
          const h = canvas.height;
          if (w === 0 || h === 0) return;
          const ratio = Math.min(window.devicePixelRatio || 1, 2);
          track.style.setProperty('--ces-grid-mask', `url("${gridMaskDataUrl(w, h, ratio, isDarkTheme())}")`);
        };
        const themeObserver = new MutationObserver(publishMask);
        themeObserver.observe(document.body, { attributes: true, attributeFilter: ['data-ds-dark-theme'] });
        resize();
        const observer = new ResizeObserver(resize);
        observer.observe(track);
        return () => { observer.disconnect(); themeObserver.disconnect(); };
      }, [active || closing]);

      // Draw loop: run while open and a field tone is active; draw one
      // settled frame otherwise. Paused while a drag is in progress: the
      // per-cell roundRect/fillRect pass (≈300 cells) competes with the
      // pointer-rate input handling for the main thread, and the eye is on
      // the thumb during a drag anyway. The settled frame stays on screen.
      useEffect(() => {
        const run = active && fieldTone !== null && !dragging && !prefersReducedMotion();
        if (!run) {
          window.cancelAnimationFrame(canvasFrameRef.current);
          canvasFrameRef.current = 0;
          if (canvasRef.current !== null && fieldTone !== null) {
            drawPixelField(canvasRef.current, ultraSinceRef.current || performance.now(), performance.now());
          }
          return undefined;
        }
        if (ultraSinceRef.current === 0) {
          ultraSinceRef.current = performance.now();
          lastCanvasFrameRef.current = 0;
        }
        const frame = (time) => {
          // Sweep frames are heavier (see REVEAL_FRAME_MS); idle frames step
          // back up to the 30fps cap.
          const interval = time - ultraSinceRef.current < REVEAL_MS ? REVEAL_FRAME_MS : FRAME_MS;
          if (time - lastCanvasFrameRef.current >= interval) {
            lastCanvasFrameRef.current = time;
            if (canvasRef.current !== null) {
              drawPixelField(canvasRef.current, ultraSinceRef.current, time);
            }
          }
          canvasFrameRef.current = window.requestAnimationFrame(frame);
        };
        canvasFrameRef.current = window.requestAnimationFrame(frame);
        return () => {
          window.cancelAnimationFrame(canvasFrameRef.current);
          canvasFrameRef.current = 0;
        };
      }, [active, fieldTone, dragging]);

      // With no directory (service missing / subagent session) render nothing,
      // exactly like the native model seat. A model with no reasoning levels
      // shows a disabled chip instead, so the plugin's presence is visible.
      if (directory === null || route === null) return null;

      const panelVisible = open || closing;
      const chipAria = stops.length < 2 || currentStop === undefined
        ? t('chip.none')
        : t('chip.aria', { effort: currentStop.name });
      const chipText = stops.length < 2 || currentStop === undefined
        ? t('effort.none')
        : currentStop.name;

      const boltIcon = h('svg', { className: 'ces-inline-icon', viewBox: '0 0 16 16', fill: 'none', 'aria-hidden': true },
        h('path', {
          d: 'M9.2 1.5 3.6 9.1h3.2l-.9 5.4 5.6-7.6H8.3l.9-5.4Z',
          fill: 'currentColor',
        }));

      const levelBadge = h(LevelLabel, {
        label: currentStop.name,
        forward: displayValue >= displayValueRef.current,
        ultra: isUltra,
        tone: fieldTone,
        longest,
      });

      const trackBlock = h('div', { className: 'ces-track-shell' },
        h('div', {
          className: 'ces-track',
          'data-ultra': isUltra ? '' : undefined,
          // data-field: the pixel field is active (Max or High). The tone
          // attribute lets CSS recolour the canvas without touching the
          // frozen drawPixelField: violet → blue is a hue rotation.
          'data-field': fieldTone === null ? undefined : '',
          'data-field-tone': fieldTone === null ? undefined : fieldTone,
          'data-canvas': fieldTone !== null && active ? '' : undefined,
          'data-revealing': revealing ? '' : undefined,
          ref: trackRef,
          // While a drag / spring is live (dragValue set) the DOM write in
          // onRangeInput runs ahead of the last render; read the live ref so a
          // render triggered by a stop crossing does not yank the fill back
          // to that crossing. At rest, use the state (the ref is one effect
          // behind on first paint).
          style: {
            '--ces-progress': String(
              dragValue === null
                ? progress
                : progressOf(displayValueRef.current, stops.length),
            ),
          },
          'aria-hidden': true,
        },
        h('div', { className: 'ces-fill' }),
        h('canvas', { className: 'ces-canvas', ref: canvasRef }),
        h('div', { className: 'ces-ticks' },
          stops.map((stop) => h('span', {
            className: 'ces-tick',
            key: stop.id === undefined ? 'auto' : stop.id,
          })))),
        h('input', {
          className: 'ces-range',
          ref: rangeRef,
          type: 'range',
          min: '0',
          max: String(stops.length - 1),
          step: '0.001',
          value: String(dragValue === null ? displayValue : displayValueRef.current),
          'aria-label': chipAria,
          'aria-valuemin': 0,
          'aria-valuemax': stops.length - 1,
          'aria-valuetext': currentStop.name,
          disabled,
          onMouseDown,
          onFocusOut,
          onPointerDown,
          onPointerMove,
          onPointerUp,
          onPointerCancel: onPointerUp,
          onInput: onRangeInput,
          onKeyDown,
        }));

      const errorBlock = error !== null && h('div', { className: 'ces-error', role: 'alert' }, error);

      // Inline: no header row of our own. The level badge is portaled into
      // the native 「模型」 row's value cell so it reads `GLM-5.4 · Max`, like
      // the composer pill; below it only the track (and an error, if any).
      if (inline) {
        return h('div', { className: 'ces-root ces-inline', ref: rootRef },
          badgeSlotNode !== null ? ReactDOM.createPortal(levelBadge, badgeSlotNode) : null,
          trackBlock,
          errorBlock,
        );
      }

      // Standalone (chip + popover) layout.
      const sliderBody = [
        h('div', { className: 'ces-header' },
          h('div', { className: 'ces-title' },
            boltIcon,
            h('span', null, t('panel.title')),
            levelBadge),
          h('span', { className: 'ces-tip', tabIndex: -1 },
            h('svg', { width: 14, height: 14, viewBox: '0 0 24 24', fill: 'none', 'aria-hidden': true },
              h('circle', { cx: 12, cy: 12, r: 9, stroke: 'currentColor', strokeWidth: 2 }),
              h('path', { d: 'M9.8 9.2a2.35 2.35 0 0 1 4.55.82c0 1.8-2.35 2.05-2.35 3.7', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round' }),
              h('path', { d: 'M12 17.2h.01', stroke: 'currentColor', strokeWidth: 2.5, strokeLinecap: 'round' })),
            h('span', { className: 'ces-tooltip', role: 'tooltip' }, t('tip.text')))),
        h('div', { className: 'ces-axis', 'aria-hidden': true },
          h('span', null, t('axis.faster')),
          h('span', null, t('axis.smarter'))),
        trackBlock,
        errorBlock,
      ];

      const chipIcon = h('svg', { className: 'ces-chip-icon', viewBox: '0 0 16 16', fill: 'none', 'aria-hidden': true },
        h('path', {
          d: 'M8 1.6 9.5 6l4.4 1.5L9.5 9 8 13.4 6.5 9 2.1 7.5 6.5 6 8 1.6Z',
          fill: 'currentColor',
        }));
      const chevron = h('svg', { className: 'ces-chevron', width: 12, height: 12, viewBox: '0 0 12 12', fill: 'none', 'aria-hidden': true },
        h('path', { d: 'm3 4.5 3 3 3-3', stroke: 'currentColor', strokeWidth: 1.4, strokeLinecap: 'round', strokeLinejoin: 'round' }));

      return h('div', { className: 'ces-root', ref: rootRef, 'data-open': open ? '' : undefined, style: { '--ces-anchor': anchorVar } },
        h('button', {
          type: 'button',
          className: 'ces-chip',
          'data-ultra': isUltra ? '' : undefined,
          'aria-expanded': open,
          'aria-haspopup': 'dialog',
          'aria-label': chipAria,
          disabled,
          onClick: () => { if (open) closePanel(); else openPanel(); },
        }, chipIcon, h('span', { className: 'ces-chip-label' }, chipText), chevron),
        panelVisible && h('section', {
          className: 'ces-panel',
          role: 'dialog',
          'aria-label': t('panel.title'),
          onKeyDown: (event) => {
            if (event.key === 'Escape') {
              event.stopPropagation();
              closePanel();
            }
          },
        }, sliderBody),
      );
    }

    // --- Native menu injection --------------------------------------------
    // The native ModelSelect menu is a React portal on document.body. Its
    // root pane renders two `role="menuitem"` rows: 「模型 ›」 then
    // 「推理等级 ›」. We replace the SECOND row in place — the slider is
    // visible as soon as the menu opens, with no drill-in step. Our host node
    // is inserted before that row (a node React never created, so
    // reconciliation leaves it alone) and the native row is hidden. Focus
    // stays inside the menu card, so the native onBlur keeps the menu open.
    //
    // The observer must not react to its own injections or to the slider's
    // own DOM churn (canvas, label swaps), or it re-sweeps every frame and
    // starves the main thread. Records caused by our host subtree are dropped
    // and sweeps are coalesced per animation frame.

    const INJECT_ATTR = 'data-ces-inject';
    // Id of the span the injector plants inside the native 「模型」 row's value
    // cell so the level badge can portal there and read `GLM-5.4 · Max`.
    const BADGE_SLOT_ID = 'ces-level-badge-slot';

    /** The native menu card on its ROOT pane (role=menu): the one the slider
     * is injected into. A drilled pane (the model list) renders the surface
     * with role=group instead, so it is deliberately not matched. Only this
     * root card is assumed to be a direct child of body — it is the one fact
     * the sweep has verified by injecting successfully. */
    function isMenuCard(node) {
      return node instanceof HTMLElement
        && node.getAttribute('role') === 'menu'
        && node.parentElement === document.body;
    }

    /**
     * The native 「推理等级」 row of a root-pane menu card: the second
     * `menuitem`, present only when the model has reasoning levels. Identified
     * by structure (two menuitem rows), never by locale text or class names.
     */
    function findEffortRow(card) {
      const rows = card.querySelectorAll(':scope > button[role="menuitem"], :scope > * > button[role="menuitem"]');
      if (rows.length < 2) return null;
      return rows[1] instanceof HTMLElement ? rows[1] : null;
    }

    /** Whether a mutation happened inside one of our injected hosts. */
    function isOwnMutation(record) {
      const target = record.target;
      if (!(target instanceof Node)) return false;
      const parent = target instanceof Element ? target : target.parentElement;
      if (parent === null) return false;
      return parent.closest(`[${INJECT_ATTR}]`) !== null;
    }

    /**
     * Install the observer that swaps the 「推理等级」 row for the slider.
     * @param {() => React.ReactElement} mountInline - renders the inline slider.
     * @returns disposer.
     */
    function installMenuInjector(mountInline) {
      const roots = new Map();
      let scheduled = false;

      // The native menu closes on any document `mousedown` it cannot attribute
      // to its trigger or card ref (ModelSelect.closeOutside). Our slider is a
      // separate React root inside the card; its events never reach the native
      // React tree, and the native check does not recognise them. Stop pointer
      // events in the BUBBLE phase at each host — after the input itself has
      // handled them, before they reach document — so a press on the slider
      // never trips that listener. Presses elsewhere still bubble normally.
      const hosts = new Set();
      let focusGuardInstalled = false;
      const focusGuard = (event) => {
        const next = event.relatedTarget;
        if (!(next instanceof Node)) return;
        for (const h of hosts) {
          if (h.contains(next)) {
            event.stopPropagation();
            return;
          }
        }
      };

      // Plant the badge slot at the end of the native 「模型」 row's value cell
      // (the cell that holds the `data-model-id` label), so the level badge
      // portals there and the row reads `GLM-5.4 · Max`. Uses the stable
      // data attributes the native renderer emits, never hashed class names.
      const plantBadgeSlot = (card) => {
        const modelLabel = card.querySelector('[data-model-id]');
        if (!(modelLabel instanceof HTMLElement)) return;
        const valueCell = modelLabel.parentElement;
        if (!(valueCell instanceof HTMLElement)) return;
        const existing = valueCell.querySelector(`:scope > #${BADGE_SLOT_ID}`);
        if (existing instanceof HTMLElement) {
          setBadgeSlot(existing);
          return;
        }
        const slot = document.createElement('span');
        slot.id = BADGE_SLOT_ID;
        slot.className = 'ces-badge-slot';
        slot.appendChild(document.createTextNode('· '));
        valueCell.append(slot);
        setBadgeSlot(slot);
      };

      const injectInto = (card) => {
        const row = findEffortRow(card);
        if (row === null) return;
        plantBadgeSlot(card);
        // Already injected right before this row: nothing to do.
        const prev = row.previousElementSibling;
        if (prev instanceof HTMLElement && prev.hasAttribute(INJECT_ATTR)) return;
        const host = document.createElement('div');
        host.setAttribute(INJECT_ATTR, '');
        host.className = 'ces-inject-host';
        row.parentElement.insertBefore(host, row);
        hosts.add(host);
        // Swallow every pointer / mouse / focus event at the host in the
        // bubble phase: the input has already handled it, and nothing above
        // the host — the native card's React tree, its document listeners,
        // or the menu primitive — may see a slider interaction. Which of
        // those closes the menu is unknowable from outside, so block them
        // all; keydown is deliberately excluded so Escape still works.
        for (const type of [
          'pointerdown', 'mousedown', 'touchstart', 'pointerup', 'mouseup', 'touchend',
          'click', 'dblclick', 'pointermove', 'mousemove', 'contextmenu',
          'focusin', 'focusout',
        ]) {
          host.addEventListener(type, (event) => event.stopPropagation());
        }
        // The native card's onBlur (React, on its own root) fires when focus
        // LEAVES a native row toward our slider: that focusout originates on
        // the native row, so the host-level stop above cannot catch it.
        // Intercept at document capture and cut any focusout whose destination
        // is inside one of our hosts — the native blur-close never sees it.
        // (Our own blur-to-close lives on the slider's range, unaffected.)
        if (!focusGuardInstalled) {
          focusGuardInstalled = true;
          document.addEventListener('focusout', focusGuard, true);
        }
        // Hide the native row and drop its menuitem role so the native
        // moveFocus / Tab queries no longer see it (they select by role).
        row.setAttribute('hidden', '');
        row.setAttribute('aria-hidden', 'true');
        row.setAttribute('data-ces-hidden', '');
        row.setAttribute('data-ces-role', row.getAttribute('role') ?? '');
        row.removeAttribute('role');
        row.setAttribute('tabindex', '-1');
        // Widen the card so the slider has room; the host then fills the
        // card's content box exactly (see the sizing note in the stylesheet).
        card.setAttribute('data-ces-card', '');
        const root = ReactDOMClient.createRoot(host);
        roots.set(host, root);
        root.render(mountInline());
      };

      const release = (host, root) => {
        const card = host.closest('[role="menu"]');
        root.unmount();
        roots.delete(host);
        hosts.delete(host);
        host.remove();
        if (card !== null) {
          card.removeAttribute('data-ces-card');
          // The badge slot lives in the native 「模型」 row; the portal
          // unmounts with our root, so only the empty slot remains to remove.
          if (badgeSlot.current !== null && card.contains(badgeSlot.current)) {
            badgeSlot.current.remove();
            setBadgeSlot(null);
          }
        }
      };

      const sweep = () => {
        scheduled = false;
        for (const card of document.body.querySelectorAll(':scope > [role="menu"]')) {
          if (isMenuCard(card)) injectInto(card);
        }
        // Unmount hosts that left the document (menu closed) OR whose native
        // row is gone (the menu drilled into the model list). The latter is
        // what keeps the slider from lingering above the model list; when the
        // user backs out to the root pane the row returns and we re-inject.
        for (const [host, root] of [...roots]) {
          if (!host.isConnected) {
            release(host, root);
            continue;
          }
          const next = host.nextElementSibling;
          const rowStillThere = next instanceof HTMLElement && next.hasAttribute('data-ces-hidden');
          if (!rowStillThere) {
            release(host, root);
            continue;
          }
          // The native 「模型」 row re-renders its value cell (e.g. after a
          // model switch) and React may drop our badge slot with it; replant
          // so the level name keeps showing. The slider's portal reads the
          // slot by id on each render, so it picks the new one up.
          const card = host.closest('[role="menu"]');
          if (card !== null) plantBadgeSlot(card);
        }
      };

      // --- Reopen at the root pane after a model pick ----------------------
      // The native ModelSelect closes the whole menu after a model is chosen
      // (settleSelection -> closeAfterSelection). The user wants to land back
      // on the root pane (the slider card) instead. We cannot reach setPane,
      // but close() resets the pane to 'root' and show() opens at the root
      // whenever a model is selected — so re-opening the native trigger right
      // after that close lands exactly there, and the slider re-injects by
      // itself.
      // Arming lives in FaceProbe (module-level reopenRequest): a model
      // CHANGE seen while the trigger reports aria-expanded=true. That
      // signal comes from the store, so it does not depend on the drilled
      // list's DOM — whose structure (role, wrappers, parent) is not ours
      // and which two earlier cuts guessed wrong. Firing is here: any
      // body-level menu surface leaving the DOM while the request is set.
      // By then React has committed open=false, so the trigger's own onClick
      // takes the show() branch. Clearing: Escape, any click outside a menu
      // surface, and every other surface removal — so no dismissal other
      // than a pick ever re-opens the menu.
      const isTriggerOpen = () => {
        const pill = document.querySelector('button[aria-haspopup="menu"][title*=" · "]');
        return pill !== null && pill.getAttribute('aria-expanded') === 'true';
      };
      const onDocumentClickCapture = (event) => {
        const target = event.target instanceof Element ? event.target : null;
        if (target === null) return;
        // A click that is not inside any menu surface cannot be a model
        // pick; drop a stale request so it never fires later.
        if (target.closest('[role="menu"], [role="group"]') === null) reopenRequest = false;
      };
      document.addEventListener('click', onDocumentClickCapture, true);
      const onDocumentKeydownCapture = (event) => {
        if (event.key === 'Escape') reopenRequest = false;
      };
      document.addEventListener('keydown', onDocumentKeydownCapture, true);
      const reopenAtRoot = () => {
        // close(true) restores focus to the trigger in a microtask; run
        // after it and use that focus as the handle, falling back to the
        // pill selector (title carries "model · effort").
        window.setTimeout(() => {
          if (isTriggerOpen()) return; // already re-opened by someone else
          const active = document.activeElement;
          const trigger = active instanceof HTMLElement
            && active.getAttribute('aria-haspopup') === 'menu'
            && active.hasAttribute('title')
            ? active
            : document.querySelector('button[aria-haspopup="menu"][title*=" · "]');
          if (trigger instanceof HTMLElement) trigger.click();
        }, 0);
      };

      const observer = new MutationObserver((records) => {
        // Diagnostics: a card leaving the DOM while a slider interaction is
        // in flight or just finished means something closed the menu from
        // under us. Log the scene so the culprit can be identified from the
        // browser console (Cmd+Opt+I → Console).
        for (const record of records) {
          for (const node of record.removedNodes) {
            if (!(node instanceof HTMLElement)) continue;
            // Any body-level element with a menu/group role: the drilled
            // list is not assumed to share the root card's markup, only to
            // be a direct child of body like every other portaled surface.
            const role = node.getAttribute('role');
            if (node.parentElement !== document.body || (role !== 'menu' && role !== 'group')) continue;
            if (reopenRequest) {
              reopenRequest = false;
              reopenAtRoot();
              continue;
            }
            reopenRequest = false;
            const sinceUp = lastPointerUpAt === 0 ? Infinity : performance.now() - lastPointerUpAt;
            const wasDragging = dragState.pointerDown;
            if (sinceUp < 1500 || wasDragging) {
              console.warn('[claude-effort-slider] menu card removed during slider interaction', {
                msSincePointerUp: sinceUp === Infinity ? 'n/a' : Math.round(sinceUp),
                pointerStillDown: wasDragging,
                activeElement: describeElement(document.activeElement),
                hostStillConnected: [...hosts].some((h) => h.isConnected),
                pending: lastCommitState,
              });
            }
          }
        }
        // Drop our own churn; only foreign DOM changes request a sweep.
        if (records.every(isOwnMutation)) return;
        if (scheduled) return;
        scheduled = true;
        requestAnimationFrame(sweep);
      });
      observer.observe(document.body, { childList: true, subtree: true });
      sweep();
      return () => {
        observer.disconnect();
        document.removeEventListener('click', onDocumentClickCapture, true);
        document.removeEventListener('keydown', onDocumentKeydownCapture, true);
        if (focusGuardInstalled) document.removeEventListener('focusout', focusGuard, true);
        for (const [host, root] of [...roots]) release(host, root);
      };
    }

    // --- Plugin body ---------------------------------------------------------
    return {
      inject: ['slots', 'locale'],
      apply(ctx) {
        ctx.locale.register(NS, { zh, en });

        ctx.effect(() => {
          const style = document.createElement('style');
          style.textContent = STYLE;
          document.head.append(style);
          return () => style.remove();
        }, 'claude-effort-slider: stylesheet');

        // `modelDirectories` and `sessions` are optional: wait for them the same
        // way the native model seat does (ctx.inject), instead of reading the
        // service getter synchronously — which throws while the service is not
        // yet registered and would otherwise hide the chip permanently.
        ctx.inject(['slots', 'modelDirectories', 'sessions'], (scope) => {
          const models = scope.modelDirectories;

          // Directory face for one session (same instance the native model
          // seat and /model popup read).
          const faceFor = (sessionId) => {
            let directory;
            try {
              directory = models.directoryFor(sessionId);
            } catch (error) {
              directory = undefined;
            }
            let selectable = false;
            if (directory !== undefined) {
              try {
                selectable = scope.sessions.subagentAddress(sessionId) === undefined;
              } catch (error) {
                selectable = true;
              }
            }
            const active = directory !== undefined && selectable;
            return {
              sessionId,
              directory: directory === undefined ? null : directory.store,
              load: () => {
                if (active) directory.load().catch(() => { /* store error */ });
              },
              select: (selection) => (active
                ? directory.select(selection)
                : Promise.resolve(undefined)),
            };
          };

          // The native ModelSelect renders in the composer's session scope. A
          // renderless probe in the same scope hands the menu injector that
          // session's directory face without touching any private API. The
          // registration's inject face arrives spread onto the props.
          let currentFace = null;
          const faceListeners = new Set();
          const setFace = (face) => {
            currentFace = face;
            for (const listener of faceListeners) listener();
          };
          function FaceProbe(props) {
            const face = useMemo(() => ({
              sessionId: props.sessionId,
              directory: props.directory,
              load: props.load,
              select: props.select,
            }), [props.sessionId, props.directory, props.load, props.select]);
            useLayoutEffect(() => {
              setFace(face);
              return () => { if (currentFace === face) setFace(null); };
            }, [face]);
            // Mirror the committed tone onto <html data-ces-tone> for as long
            // as this probe is mounted (i.e. while the composer shows this
            // session), so the level text — our badge AND the native composer
            // pill — takes the field colour even with the menu closed.
            const directory = props.directory;
            const snapshot = useSyncExternalStore(
              directory === null ? noopSubscribe : (fn) => directory.subscribe(fn),
              directory === null ? () => null : () => directory.getSnapshot(),
            );
            const tone = useMemo(() => toneFromSnapshot(snapshot), [snapshot]);
            useEffect(() => {
              const root = document.documentElement;
              if (tone === null) root.removeAttribute('data-ces-tone');
              else root.setAttribute('data-ces-tone', tone);
              return () => { root.removeAttribute('data-ces-tone'); };
            }, [tone]);
            // Restore the remembered effort on a MODEL change — here, in the
            // always-mounted probe, not in the slider: the slider is not
            // mounted while the user picks a model in the native list, so a
            // restore there only ran once the menu was opened again ("had to
            // click the pill first"). A native model switch submits
            // {provider, model} with no reasoningEffort, so the store sits on
            // the catalog default; if this model has a memory, re-select once
            // with it through directory.select so the session, /model and
            // the pill all agree. lastModelKey is module level and survives
            // every mount; only an actual change of model fires this.
            const restoringRef = useRef(false);
            const select = props.select;
            useEffect(() => {
              if (snapshot === null || select === undefined || select === null) return;
              const { route, reasoning } = selectionFromSnapshot(snapshot);
              if (route === null || reasoning === undefined) return;
              const key = memoryKey(route.provider, route.model);
              if (lastModelKey === null) {
                // First sight ever: adopt it, never restore on this tick.
                lastModelKey = key;
                return;
              }
              if (lastModelKey === key) return; // same model — nothing to restore
              lastModelKey = key;
              // A model CHANGE is the one reliable "the user picked a model"
              // signal: it comes from the store, not from guessing the DOM of
              // the drilled list. Whether it was picked INSIDE the menu is
              // read off the native trigger's own aria-expanded at this
              // instant (the effect runs right after the store echoed the
              // pick, before React has unmounted the closing card). /model
              // and other non-menu switches happen with the menu shut, so
              // they never arm. The injector fires the reopen once the card
              // has actually left the DOM (open is false by then).
              const active = document.activeElement;
              const pill = active instanceof HTMLElement
                && active.getAttribute('aria-haspopup') === 'menu'
                && active.hasAttribute('title')
                ? active
                : document.querySelector('button[aria-haspopup="menu"][title*=" · "]');
              // submit() focuses the trigger synchronously before the RPC,
              // so the focused pill is proof of an in-menu pick even if the
              // store update and the close land in one React batch and
              // aria-expanded has already flipped to false by now.
              if (pill !== null && (active === pill || pill.getAttribute('aria-expanded') === 'true')) {
                reopenRequest = true;
              }
              if (route.reasoningEffort !== undefined) return; // explicit wins
              if (restoringRef.current) return;
              const remembered = recallEffort(route.provider, route.model);
              if (remembered === undefined) return;
              // The remembered id must still exist on this model (catalogs
              // differ; Auto is the undefined entry when there is no default).
              const hasAuto = reasoning.defaultEffort === undefined;
              const known = remembered === null ? hasAuto
                : reasoning.efforts.some((effort) => effort.id === remembered);
              if (!known) return;
              const current = route.reasoningEffort !== undefined
                ? route.reasoningEffort : reasoning.defaultEffort;
              if ((remembered === null ? undefined : remembered) === current) return; // already there
              restoringRef.current = true;
              Promise.resolve(
                select({
                  provider: route.provider,
                  model: route.model,
                  // null = Auto: omit the field so the adapter picks, exactly
                  // as the slider's own commit does for the synthetic stop.
                  ...(remembered === null ? {} : { reasoningEffort: remembered }),
                }),
              ).then(() => { restoringRef.current = false; }).catch(() => { restoringRef.current = false; });
            }, [snapshot, select]);
            return null;
          }

          scope.slots.inject(SLOT, () => scope.slots.register({
            name: SLOT,
            id: 'claude-effort-slider',
            order: SLOT_ORDER,
            inject: faceFor,
          }, FaceProbe));

          // The slider lives inside the native menu's effort pane. It renders
          // from the face the probe last saw, so it always targets the session
          // whose composer is showing.
          const t = scope.locale.bind(NS);
          // Native dictionary, for the pill's own "Default" word. Guarded:
          // if the namespace is not bound here, EffortChip falls back to
          // its own label rather than throwing inside the menu.
          let tNative;
          try { tNative = scope.locale.bind(NATIVE_NS); } catch { tNative = undefined; }
          function InlineSlider() {
            const [, force] = useState(0);
            useEffect(() => {
              const listener = () => force((n) => n + 1);
              faceListeners.add(listener);
              return () => { faceListeners.delete(listener); };
            }, []);
            if (currentFace === null || currentFace.directory === null) return null;
            return h(EffortChip, {
              inline: true,
              directory: currentFace.directory,
              load: currentFace.load,
              select: currentFace.select,
              t,
              tNative,
            });
          }
          scope.effect(() => installMenuInjector(() => h(InlineSlider)), 'claude-effort-slider: menu injector');
        });
      },
    };
  },
});
