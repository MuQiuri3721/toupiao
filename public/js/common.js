'use strict';

/* ===== API 基地址 =====
 * 页面有三种部署位置：
 *  1) https://dreamlast.cn/vote/  —— nginx 同源托管，接口走同域反代（前缀 /vote）
 *  2) COS 等 myqcloud 域名        —— 接口直连投票服务器
 *  3) 服务器 8010 直连             —— 同源，空串
 */
const API_BASE = location.pathname.indexOf('/vote/') === 0 ? '/vote'
  : /(^|\.)myqcloud\.com$/i.test(location.hostname) ? 'http://dreamlast.cn:8010' : '';

/* ===== 设备标识：本地生成 32 位十六进制，与服务器 Cookie 格式一致 ===== */
function deviceId() {
  let id = localStorage.getItem('vv_dev');
  if (!id || !/^[0-9a-f]{32}$/.test(id)) {
    const a = new Uint8Array(16);
    crypto.getRandomValues(a);
    id = [...a].map(b => b.toString(16).padStart(2, '0')).join('');
    try { localStorage.setItem('vv_dev', id); } catch (_) {}
  }
  return id;
}

/* ===== 请求封装 ===== */
async function fetchJSON(url, opts = {}) {
  const res = await fetch(API_BASE + url, opts);
  let data = {};
  try { data = await res.json(); } catch (_) {}
  if (!res.ok) {
    const err = new Error(data.error || ('HTTP ' + res.status));
    err.status = res.status;
    throw err;
  }
  return data;
}

/* ===== SSE 实时订阅（自动重连；onStatus 用于页面显示断线提示） ===== */
function connectEvents(handler, onStatus) {
  let es = null, stopped = false;
  function open() {
    es = new EventSource(API_BASE + '/api/events');
    es.onopen = () => { if (onStatus) onStatus(true); };
    es.onmessage = e => {
      try { handler(JSON.parse(e.data)); } catch (err) { console.warn('事件处理异常:', err.message); }
    };
    es.onerror = () => {
      es.close();
      if (onStatus) onStatus(false);
      if (!stopped) setTimeout(open, 2000);
    };
  }
  open();
  return () => { stopped = true; if (es) es.close(); };
}

/* ===== 工具 ===== */
function fmt(n) { return Number(n || 0).toLocaleString('zh-CN'); }

function prefersReducedMotion() {
  return !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
}

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, m => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]
  ));
}

function avatarColor(name) {
  // 暖色相区间（金/琥珀/砖红/铜），贴合午夜场票根氛围
  const warmHues = [38, 18, 8, 28, 12, 45, 350, 32];
  let h = 0;
  for (const ch of String(name || '?')) h = (h * 31 + ch.codePointAt(0)) >>> 0;
  return 'hsl(' + warmHues[h % warmHues.length] + ' 50% 36%)';
}

function timeStr(ts) {
  const d = new Date(ts);
  const p = x => String(x).padStart(2, '0');
  return p(d.getHours()) + ':' + p(d.getMinutes()) + ':' + p(d.getSeconds());
}

/* 数字滚动动画（系统开启"减少动态效果"时直接跳到目标值） */
function countUp(el, to, from, dur) {
  dur = dur || 450;
  if (prefersReducedMotion() || from == null || from === to) { el.textContent = fmt(to); return; }
  const t0 = performance.now();
  (function frame(t) {
    const k = Math.min(1, (t - t0) / dur);
    const v = Math.round(from + (to - from) * (1 - Math.pow(1 - k, 3)));
    el.textContent = fmt(v);
    if (k < 1) requestAnimationFrame(frame);
  })(t0);
}

/* ===== 二维码渲染（qrcode-generator 本地库，缺库时降级为文字） ===== */
function renderQR(el, text, cellSize) {
  if (typeof qrcode === 'function') {
    try {
      const qr = qrcode(0, 'M');
      qr.addData(text);
      qr.make();
      el.innerHTML = qr.createSvgTag({ cellSize: cellSize || 4, margin: 2 });
      return;
    } catch (_) {}
  }
  el.innerHTML = '<div class="qr-fallback">' + esc(text) + '</div>';
}

/* ===== 轻提示 ===== */
function toast(msg, type) {
  let box = document.getElementById('vv-toast');
  if (!box) {
    box = document.createElement('div');
    box.id = 'vv-toast';
    document.body.appendChild(box);
  }
  const t = document.createElement('div');
  t.className = 'vv-toast-item' + (type ? ' ' + type : '');
  t.textContent = msg;
  box.appendChild(t);
  requestAnimationFrame(() => t.classList.add('show'));
  setTimeout(() => {
    t.classList.remove('show');
    setTimeout(() => t.remove(), 300);
  }, 2200);
}
