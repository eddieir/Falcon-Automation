"use strict";
/**
 * Init-script string that draws a visible DOM cursor and click ripple so a
 * screen recording shows where the (otherwise invisible) Playwright mouse is.
 * Purely cosmetic: pointer-events none, never intercepts input.
 */
module.exports = `(() => {
  if (window.__falconDemoCursor) return;
  window.__falconDemoCursor = true;
  const mount = () => {
    if (!document.body) return false;
    const cur = document.createElement('div');
    cur.setAttribute('data-demo-cursor', '');
    cur.style.cssText = 'position:fixed;left:0;top:0;width:18px;height:18px;margin:-9px 0 0 -9px;border-radius:50%;' +
      'background:rgba(255,99,71,.85);border:2px solid #fff;box-shadow:0 0 6px rgba(0,0,0,.5);pointer-events:none;' +
      'z-index:2147483647;transition:transform .08s;display:none';
    document.body.appendChild(cur);
    document.addEventListener('mousemove', (e) => {
      cur.style.display = 'block';
      cur.style.left = e.clientX + 'px';
      cur.style.top = e.clientY + 'px';
    }, true);
    document.addEventListener('mousedown', (e) => {
      cur.style.transform = 'scale(.7)';
      const r = document.createElement('div');
      r.style.cssText = 'position:fixed;width:18px;height:18px;margin:-9px 0 0 -9px;border-radius:50%;' +
        'border:3px solid rgba(255,99,71,.9);pointer-events:none;z-index:2147483646;left:' + e.clientX + 'px;top:' + e.clientY +
        'px;transition:transform .5s ease-out,opacity .5s ease-out;opacity:1';
      document.body.appendChild(r);
      requestAnimationFrame(() => { r.style.transform = 'scale(3.5)'; r.style.opacity = '0'; });
      setTimeout(() => r.remove(), 600);
    }, true);
    document.addEventListener('mouseup', () => { cur.style.transform = ''; }, true);
    return true;
  };
  if (!mount()) document.addEventListener('DOMContentLoaded', mount, { once: true });
})();`;
