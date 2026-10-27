'use strict';

/* 舞台装饰层：数据粒子 / 光柱 / 方形星点 / 扫描线 —— 纯 CSS 动画，页面按需调用 */

function _rnd(a, b) { return a + Math.random() * (b - a); }

/* 上升数据粒子（可掺入琥珀色变体） */
function decorParticles(el, n, altRatio) {
  if (!el) return;
  const frag = document.createDocumentFragment();
  for (let i = 0; i < n; i++) {
    const p = document.createElement('i');
    p.className = 'dec-particle' + (Math.random() < (altRatio || 0.25) ? ' alt' : '');
    p.style.cssText =
      'left:' + _rnd(0, 100).toFixed(2) + '%;' +
      'animation-delay:-' + _rnd(0, 14).toFixed(2) + 's;' +
      'animation-duration:' + _rnd(9, 18).toFixed(2) + 's;';
    frag.appendChild(p);
  }
  el.appendChild(frag);
}

/* 垂直光柱（舞台灯条） */
function decorBeams(el, n) {
  if (!el) return;
  const frag = document.createDocumentFragment();
  for (let i = 0; i < n; i++) {
    const b = document.createElement('i');
    b.className = 'dec-beam' + (Math.random() < 0.35 ? ' alt' : '');
    b.style.cssText =
      'left:' + _rnd(3, 97).toFixed(2) + '%;' +
      'height:' + _rnd(18, 40).toFixed(0) + 'vh;' +
      'animation-delay:-' + _rnd(0, 5).toFixed(2) + 's;' +
      'animation-duration:' + _rnd(4, 8).toFixed(2) + 's;';
    frag.appendChild(b);
  }
  el.appendChild(frag);
}

/* 方形星点（深色大屏背景） */
function decorStars(el, n) {
  if (!el) return;
  const frag = document.createDocumentFragment();
  for (let i = 0; i < n; i++) {
    const s = document.createElement('i');
    s.className = 'dec-star';
    s.style.cssText =
      'left:' + _rnd(0, 100).toFixed(2) + '%;top:' + _rnd(0, 100).toFixed(2) + '%;' +
      'animation-delay:' + _rnd(0, 6).toFixed(2) + 's;' +
      'animation-duration:' + _rnd(2.5, 6).toFixed(2) + 's;';
    frag.appendChild(s);
  }
  el.appendChild(frag);
}

/* 扫描线 */
function decorScan(el) {
  if (!el) return;
  const s = document.createElement('i');
  s.className = 'scanline';
  s.style.animationDelay = '-' + _rnd(0, 8).toFixed(2) + 's';
  el.appendChild(s);
}
