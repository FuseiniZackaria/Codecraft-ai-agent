/**
 * Website walkthrough scenes for HyperFrames, built from the sharp screenshots
 * the explorer took (no blurry screen recording):
 *   top    - the top of a page with a slow push-in
 *   scroll - a smooth scroll down the page
 *   click  - a cursor moves to a feature, clicks (ripple), and the result appears
 * Returns { css, parts, tl } for graphics.compositionHtml (scenes sit under the
 * captions, intro and call-to-action card).
 */

const CURSOR = (size) => `<svg width="${size}" height="${size}" viewBox="0 0 32 32"><path d="M4 2 L4 26 L10.5 19.5 L15 29 L19 27 L14.5 18 L23 18 Z" fill="#FFFFFF" stroke="#111111" stroke-width="2" stroke-linejoin="round"/></svg>`;

/**
 * @param scenes  [{ page, show, click, start, duration }]  (times in seconds)
 * @param pages   explorer pages: { p, shot, width (css), height (css), clicks: [{ c, box, scrollY, shot }] }
 * @param W, H    frame size
 */
function buildScenes({ scenes, pages, W, H, accent }) {
  const byP = new Map(pages.map((pg) => [pg.p, pg]));
  const kk = Math.min(W, H) / 1080;
  const css = `
.clip.scene { z-index: 1; }
.scene-in { position: absolute; inset: 0; overflow: hidden; }
.scene-in img.page { position: absolute; left: 0; top: 0; width: ${W}px; height: auto; transform-origin: 50% 0%; }
.scene-in img.after { position: absolute; left: 0; top: 0; width: ${W}px; height: ${H}px; object-fit: cover; object-position: top; }
.cursor { position: absolute; left: 0; top: 0; width: ${Math.round(52 * kk)}px; height: ${Math.round(52 * kk)}px; filter: drop-shadow(0 ${Math.round(4 * kk)}px ${Math.round(8 * kk)}px rgba(0,0,0,0.45)); }
.ripple { position: absolute; width: ${Math.round(90 * kk)}px; height: ${Math.round(90 * kk)}px; margin: -${Math.round(45 * kk)}px 0 0 -${Math.round(45 * kk)}px; border-radius: 50%; border: ${Math.round(6 * kk)}px solid ${accent}; }`;
  const parts = [];
  const tl = [];
  scenes.forEach((sc, i) => {
    const pg = byP.get(sc.page);
    if (!pg) return;
    const id = `s${i}`;
    const k = W / pg.width; // css px -> frame px
    const pageH = pg.height * k;
    const start = sc.start.toFixed(3);
    const d = sc.duration;
    const fade = `tl.fromTo("#${id}-in", { opacity: 0 }, { opacity: 1, duration: 0.25, ease: "none" }, ${start});`;
    if (sc.show === 'click') {
      const c = (pg.clicks || []).find((x) => x.c === sc.click);
      const y0 = -Math.max(0, Math.min(c.box.y * k - H * 0.42, pageH - H));
      const cx = (c.box.x + c.box.w / 2) * k;
      const cy = c.box.y * k + y0 + (c.box.h / 2) * k;
      parts.push(`<div id="${id}" class="clip scene" data-start="${start}" data-duration="${d.toFixed(3)}" data-track-index="0"><div id="${id}-in" class="scene-in">`
        + `<img class="page" src="assets/${pg.shot}" alt="" style="top:${y0.toFixed(1)}px">`
        + `<img id="${id}-after" class="after" src="assets/${c.shot}" alt="" style="opacity:0">`
        + `<div id="${id}-rip" class="ripple" style="left:${cx.toFixed(1)}px;top:${cy.toFixed(1)}px;opacity:0"></div>`
        + `<div id="${id}-cur" class="cursor">${CURSOR(Math.round(52 * kk))}</div></div></div>`);
      tl.push(fade);
      tl.push(`tl.fromTo("#${id}-cur", { x: ${(W * 0.82).toFixed(1)}, y: ${(H * 0.86).toFixed(1)} }, { x: ${(cx - 8 * kk).toFixed(1)}, y: ${(cy - 6 * kk).toFixed(1)}, duration: 0.9, ease: "power2.inOut" }, ${(sc.start + 0.3).toFixed(3)});`);
      tl.push(`tl.fromTo("#${id}-rip", { scale: 0.3, opacity: 0.9 }, { scale: 1.4, opacity: 0, duration: 0.5, ease: "power2.out" }, ${(sc.start + 1.25).toFixed(3)});`);
      tl.push(`tl.fromTo("#${id}-after", { opacity: 0 }, { opacity: 1, duration: 0.35, ease: "none" }, ${(sc.start + 1.5).toFixed(3)});`);
      tl.push(`tl.fromTo("#${id}-after", { scale: 1 }, { scale: 1.05, duration: ${Math.max(0.5, d - 1.6).toFixed(3)}, ease: "none" }, ${(sc.start + 1.6).toFixed(3)});`);
      return;
    }
    parts.push(`<div id="${id}" class="clip scene" data-start="${start}" data-duration="${d.toFixed(3)}" data-track-index="0"><div id="${id}-in" class="scene-in"><img id="${id}-img" class="page" src="assets/${pg.shot}" alt=""></div></div>`);
    tl.push(fade);
    if (sc.show === 'scroll' && pageH > H * 1.15) {
      const travel = Math.min(pageH - H, H * 2.4);
      tl.push(`tl.fromTo("#${id}-img", { y: 0 }, { y: ${(-travel).toFixed(1)}, duration: ${Math.max(0.8, d - 1.2).toFixed(3)}, ease: "sine.inOut" }, ${(sc.start + 0.7).toFixed(3)});`);
    } else {
      tl.push(`tl.fromTo("#${id}-img", { scale: 1 }, { scale: 1.06, duration: ${d.toFixed(3)}, ease: "none" }, ${start});`);
    }
  });
  return { css, parts, tl };
}

module.exports = { buildScenes };
