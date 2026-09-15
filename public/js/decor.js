'use strict';

/* 唯美装饰层：星星 / 花瓣 / 音符 —— 纯 CSS 动画，页面按需调用 */

function _rnd(a, b) { return a + Math.random() * (b - a); }

function decorStars(el, n) {
  if (!el) return;
  const frag = document.createDocumentFragment();
  for (let i = 0; i < n; i++) {
    const s = document.createElement('i');
    const size = _rnd(1, 3).toFixed(1);
    s.className = 'dec-star';
    s.style.cssText =
      'left:' + _rnd(0, 100).toFixed(2) + '%;top:' + _rnd(0, 100).toFixed(2) + '%;' +
      'width:' + size + 'px;height:' + size + 'px;' +
      'animation-delay:' + _rnd(0, 6).toFixed(2) + 's;' +
      'animation-duration:' + _rnd(2.5, 6).toFixed(2) + 's;';
    frag.appendChild(s);
  }
  el.appendChild(frag);
}

function decorPetals(el, n) {
  if (!el) return;
  const frag = document.createDocumentFragment();
  for (let i = 0; i < n; i++) {
    const p = document.createElement('i');
    const w = _rnd(9, 16).toFixed(0);
    p.className = 'dec-petal';
    p.style.cssText =
      'left:' + _rnd(0, 100).toFixed(2) + '%;' +
      'width:' + w + 'px;height:' + Math.round(w * 0.78) + 'px;' +
      'animation-delay:-' + _rnd(0, 16).toFixed(2) + 's;' +
      'animation-duration:' + _rnd(11, 20).toFixed(2) + 's;' +
      'opacity:' + _rnd(0.4, 0.85).toFixed(2) + ';';
    frag.appendChild(p);
  }
  el.appendChild(frag);
}

function decorNotes(el, n, chars) {
  if (!el) return;
  const set = chars || ['♪', '♫', '♬', '♡', '✧'];
  const frag = document.createDocumentFragment();
  for (let i = 0; i < n; i++) {
    const t = document.createElement('i');
    t.className = 'dec-note';
    t.textContent = set[Math.floor(Math.random() * set.length)];
    t.style.cssText =
      'left:' + _rnd(2, 98).toFixed(2) + '%;' +
      'font-size:' + _rnd(12, 26).toFixed(0) + 'px;' +
      'animation-delay:-' + _rnd(0, 22).toFixed(2) + 's;' +
      'animation-duration:' + _rnd(12, 24).toFixed(2) + 's;';
    frag.appendChild(t);
  }
  el.appendChild(frag);
}
