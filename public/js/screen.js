'use strict';

let S = null;
const rows = new Map();          // 榜单：id -> { el, votes }
const chartCols = new Map();     // 柱状图：id -> { el, votes }
let firstRender = true;          // 榜单首次渲染标记
let chartFirst = true;           // 柱状图首次渲染标记
let qrLast = '';
let prevTotalVotes = null;

const $title = document.getElementById('title');
const $statusBadge = document.getElementById('statusBadge');
const $statusText = document.getElementById('statusText');
const $clock = document.getElementById('clock');
const $totalVotes = document.getElementById('totalVotes');
const $ranking = document.getElementById('ranking');
const $emptyTip = document.getElementById('emptyTip');
const $chart = document.getElementById('chart');
const $feed = document.getElementById('feed');
const $qrBox = document.getElementById('qrBox');
const $qrUrl = document.getElementById('qrUrl');
const $statContestants = document.getElementById('statContestants');
const $statDevices = document.getElementById('statDevices');
const $trendCanvas = document.getElementById('trendChart');
const $voteRate = document.getElementById('voteRate');

const STATUS_TEXT = { ready: '未开始', open: '投票进行中', ended: '投票已结束' };

/* 时钟 */
setInterval(() => {
  const d = new Date();
  const p = x => String(x).padStart(2, '0');
  $clock.textContent = p(d.getHours()) + ':' + p(d.getMinutes()) + ':' + p(d.getSeconds());
}, 1000);

/* 全屏 */
document.getElementById('fsBtn').addEventListener('click', () => {
  if (document.fullscreenElement) document.exitFullscreen();
  else document.documentElement.requestFullscreen().catch(() => {});
});

/* 首次创建的元素播放交错入场动画，播完移除类（移动 DOM 节点会重启 CSS 动画） */
function enterOnce(el, i) {
  if (prefersReducedMotion()) return;
  el.classList.add('enter');
  el.style.setProperty('--i', i);
  setTimeout(() => el.classList.remove('enter'), 1800);
}

/* ---------- 排行榜（FLIP 换位动画） ---------- */

function buildRow() {
  const el = document.createElement('div');
  el.className = 'row';
  el.innerHTML =
    '<div class="rank"></div>' +
    '<div class="avatar"></div>' +
    '<div class="info">' +
      '<div class="name-line"><span class="name"></span><span class="meta"></span></div>' +
      '<div class="bar"><i></i></div>' +
    '</div>' +
    '<div class="votes"><b>0</b><span>票</span></div>';
  return el;
}

function updateRow(el, c, rank, maxVotes, prevVotes) {
  el.classList.toggle('top1', rank === 1);
  el.classList.toggle('top2', rank === 2);
  el.classList.toggle('top3', rank === 3);
  el.classList.toggle('safe', rank <= 10 && rank > 3);
  el.classList.toggle('out', rank > 10);
  el.querySelector('.rank').textContent =
    rank === 1 ? '🥇' : rank === 2 ? '🥈' : rank === 3 ? '🥉' : rank;

  const avatar = el.querySelector('.avatar');
  if (c.photoRev) {
    const src = '/api/photo/' + c.id + '?v=' + c.photoRev;
    if (avatar.dataset.src !== src) {
      avatar.dataset.src = src;
      avatar.style.background = avatarColor(c.name);
      avatar.innerHTML = '<img src="' + src + '" alt="">';
    }
  } else if (avatar.dataset.initial !== c.name) {
    avatar.dataset.initial = c.name;
    avatar.dataset.src = '';
    avatar.style.background = avatarColor(c.name);
    avatar.textContent = (c.name || '?').slice(0, 1);
  }

  el.querySelector('.name').textContent = c.name;
  el.querySelector('.meta').textContent =
    (c.className ? c.className : '') + (c.song ? (c.className ? ' · ' : '') + '《' + c.song + '》' : '');

  const pct = maxVotes > 0 ? Math.max(c.votes > 0 ? 6 : 0, c.votes / maxVotes * 100) : 0;
  el.querySelector('.bar i').style.width = pct + '%';

  countUp(el.querySelector('.votes b'), c.votes, prevVotes);
}

function renderRanking(list) {
  $emptyTip.style.display = list.length ? 'none' : '';
  if (!list.length) { firstRender = false; return; }

  // FLIP 第一步：记录旧位置
  const firstPos = new Map();
  for (const [, r] of rows) firstPos.set(r.el, r.el.getBoundingClientRect().top);

  const maxVotes = list.length ? list[0].votes : 0;
  const seen = new Set();
  list.forEach((c, i) => {
    const rank = i + 1;
    seen.add(c.id);
    let r = rows.get(c.id);
    if (!r) {
      r = { el: buildRow(c), votes: 0 };
      rows.set(c.id, r);
      r.el.dataset.id = c.id;
      $ranking.appendChild(r.el);
      enterOnce(r.el, i);
    }
    updateRow(r.el, c, rank, maxVotes, r.votes);
    r.votes = c.votes;
    r.el.dataset.rank = rank;
  });

  // 移除消失的选手
  for (const [id, r] of rows) {
    if (!seen.has(id)) { r.el.remove(); rows.delete(id); }
  }

  // 顺序变化时才重排 DOM（移动节点会重启入场动画）
  const rowEls = [...$ranking.querySelectorAll('.row')];
  if (rowEls.map(el => el.dataset.id).join('|') !== list.map(c => c.id).join('|')) {
    rowEls.sort((a, b) => a.dataset.rank - b.dataset.rank)
      .forEach(el => $ranking.appendChild(el));
  }

  if (firstRender) { firstRender = false; return; }

  // FLIP 第二步：从旧位置平滑滑到新位置
  for (const [, r] of rows) {
    const y0 = firstPos.get(r.el);
    if (y0 == null) continue;
    const dy = y0 - r.el.getBoundingClientRect().top;
    if (Math.abs(dy) > 2) {
      r.el.style.transition = 'none';
      r.el.style.transform = 'translateY(' + dy + 'px)';
      requestAnimationFrame(() => {
        r.el.style.transition = 'transform .55s cubic-bezier(.22,1,.36,1)';
        r.el.style.transform = '';
      });
    }
  }
}

/* ---------- 柱状图 ---------- */

function buildCol() {
  const el = document.createElement('div');
  el.className = 'col';
  el.innerHTML =
    '<div class="col-track">' +
      '<div class="col-rank"></div>' +
      '<div class="col-fill"><div class="col-num"><b>0</b></div></div>' +
    '</div>' +
    '<div class="col-floor"><i class="col-refl"></i></div>' +
    '<div class="col-name"></div>' +
    '<div class="col-meta"></div>';
  return el;
}

function updateCol(col, c, rank, maxVotes) {
  const el = col.el;
  el.className = 'col' +
    (rank === 1 ? ' top1' : rank === 2 ? ' top2' : rank === 3 ? ' top3' : '') +
    (rank > 3 && rank <= 10 ? ' safe' : '') +
    (rank > 10 ? ' out' : '');
  el.dataset.rank = rank;
  el.querySelector('.col-rank').textContent =
    rank === 1 ? '👑' : rank === 2 ? '🥈' : rank === 3 ? '🥉' : rank;
  el.querySelector('.col-name').textContent = c.name;
  el.querySelector('.col-meta').textContent = c.className || '';

  let pct = maxVotes > 0 ? c.votes / maxVotes * 100 : 0;
  if (c.votes > 0 && pct < 4) pct = 4;
  el.style.setProperty('--h', pct + '%');
  el.querySelector('.col-fill').style.height = pct + '%';

  // 台面倒影高度跟随柱高
  const track = el.querySelector('.col-track');
  const refl = el.querySelector('.col-refl');
  requestAnimationFrame(() => {
    refl.style.height = Math.round(track.clientHeight * pct / 100 * 0.4) + 'px';
  });

  const numEl = el.querySelector('.col-num b');
  const grew = col.votes >= 0 && c.votes > col.votes;
  countUp(numEl, c.votes, col.votes < 0 ? null : col.votes, 500);
  if (grew && !prefersReducedMotion()) {
    numEl.classList.remove('pop');
    void numEl.offsetWidth;
    numEl.classList.add('pop');
    setTimeout(() => numEl.classList.remove('pop'), 500);
  }
  col.votes = c.votes;

  // 名次上升：整柱闪光一次
  const prevRank = el.dataset.prevRank ? +el.dataset.prevRank : 0;
  if (prevRank && rank < prevRank && !prefersReducedMotion()) {
    el.classList.remove('flash');
    void el.offsetWidth;
    el.classList.add('flash');
    setTimeout(() => el.classList.remove('flash'), 950);
  }
  el.dataset.prevRank = rank;
}

function renderChart(list) {
  if (!list.length) { chartFirst = false; return; }

  // FLIP：记录旧水平位置
  const firstLeft = new Map();
  for (const [, col] of chartCols) firstLeft.set(col.el, col.el.getBoundingClientRect().left);

  const maxVotes = list.length ? list[0].votes : 0;
  const seen = new Set();
  list.forEach((c, i) => {
    seen.add(c.id);
    let col = chartCols.get(c.id);
    if (!col) {
      col = { el: buildCol(), votes: -1 };
      chartCols.set(c.id, col);
      col.el.dataset.id = c.id;
      $chart.appendChild(col.el);
      enterOnce(col.el, i);
    }
    updateCol(col, c, i + 1, maxVotes);
  });
  for (const [id, col] of chartCols) {
    if (!seen.has(id)) { col.el.remove(); chartCols.delete(id); }
  }

  // 顺序变化时才重排 DOM（移动节点会重启入场动画）
  const cols = [...$chart.querySelectorAll('.col')];
  if (cols.map(el => el.dataset.id).join('|') !== list.map(c => c.id).join('|')) {
    cols.sort((a, b) => a.dataset.rank - b.dataset.rank)
      .forEach(el => $chart.appendChild(el));
  }

  if (chartFirst) { chartFirst = false; return; }

  // 柱子水平换位动画
  for (const [, col] of chartCols) {
    const x0 = firstLeft.get(col.el);
    if (x0 == null) continue;
    const dx = x0 - col.el.getBoundingClientRect().left;
    if (Math.abs(dx) > 2) {
      col.el.style.transition = 'none';
      col.el.style.transform = 'translateX(' + dx + 'px)';
      requestAnimationFrame(() => {
        col.el.style.transition = 'transform .55s cubic-bezier(.22,1,.36,1)';
        col.el.style.transform = '';
      });
    }
  }
}

/* ---------- 票数走势（实时曲线） ---------- */

const trend = [];   // 每秒最多一个采样点 { sec, t, v }
let trendDrawPending = false;

function pushTrend(total) {
  const now = Date.now();
  const sec = Math.floor(now / 1000);
  const last = trend[trend.length - 1];
  if (last && last.sec === sec) {
    last.v = total;
    last.t = now;
  } else {
    trend.push({ sec, t: now, v: total });
    while (trend.length > 180) trend.shift();   // 最多保留 3 分钟
  }
  updateVoteRate();
  if (!trendDrawPending) {
    trendDrawPending = true;
    requestAnimationFrame(() => { trendDrawPending = false; drawTrend(); });
  }
}

function updateVoteRate() {
  if (trend.length < 2) { $voteRate.textContent = '--'; return; }
  const newest = trend[trend.length - 1];
  // 取约 60 秒前的采样点计算票速
  let base = trend[0];
  for (const p of trend) {
    if (newest.t - p.t <= 60000) { base = p; break; }
  }
  const mins = (newest.t - base.t) / 60000;
  if (mins <= 0) { $voteRate.textContent = '--'; return; }
  const rate = Math.max(0, (newest.v - base.v) / mins);
  $voteRate.textContent = rate >= 10 ? Math.round(rate) : rate.toFixed(1);
}

function drawTrend() {
  const canvas = $trendCanvas;
  const dpr = window.devicePixelRatio || 1;
  const w = canvas.clientWidth, h = canvas.clientHeight;
  if (!w || !h) return;
  if (canvas.width !== Math.round(w * dpr)) canvas.width = Math.round(w * dpr);
  if (canvas.height !== Math.round(h * dpr)) canvas.height = Math.round(h * dpr);
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);

  const padL = 8, padR = 10, padT = 12, padB = 8;
  const iw = w - padL - padR, ih = h - padT - padB;

  // 网格线
  ctx.strokeStyle = 'rgba(255,255,255,.07)';
  ctx.lineWidth = 1;
  for (let g = 1; g <= 3; g++) {
    const y = padT + ih * g / 4;
    ctx.beginPath(); ctx.moveTo(padL, y); ctx.lineTo(w - padR, y); ctx.stroke();
  }

  if (trend.length < 2) {
    ctx.fillStyle = 'rgba(169,156,216,.75)';
    ctx.font = '12px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('等待投票数据…', w / 2, h / 2 + 4);
    return;
  }

  const t0 = trend[0].t, t1 = trend[trend.length - 1].t;
  let vMin = Infinity, vMax = -Infinity;
  for (const p of trend) { if (p.v < vMin) vMin = p.v; if (p.v > vMax) vMax = p.v; }
  const span = Math.max(6, vMax - vMin);
  const y0 = Math.max(0, vMin - span * 0.18);
  const y1 = vMax + span * 0.18;

  const X = t => padL + (t - t0) / Math.max(1, t1 - t0) * iw;
  const Y = v => padT + (1 - (v - y0) / (y1 - y0)) * ih;

  // 平滑曲线（中点二次贝塞尔）
  const pts = trend.map(p => [X(p.t), Y(p.v)]);
  const lastX = pts[pts.length - 1][0], lastY = pts[pts.length - 1][1];

  const linePath = new Path2D();
  linePath.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length - 1; i++) {
    const mx = (pts[i][0] + pts[i + 1][0]) / 2;
    const my = (pts[i][1] + pts[i + 1][1]) / 2;
    linePath.quadraticCurveTo(pts[i][0], pts[i][1], mx, my);
  }
  linePath.lineTo(lastX, lastY);

  // 渐变面积
  const area = new Path2D(linePath);
  area.lineTo(lastX, padT + ih);
  area.lineTo(pts[0][0], padT + ih);
  area.closePath();
  const g = ctx.createLinearGradient(0, padT, 0, padT + ih);
  g.addColorStop(0, 'rgba(247,168,255,.32)');
  g.addColorStop(1, 'rgba(139,124,246,.02)');
  ctx.fillStyle = g;
  ctx.fill(area);

  // 发光描边
  const lg = ctx.createLinearGradient(padL, 0, w - padR, 0);
  lg.addColorStop(0, '#ffb7dc');
  lg.addColorStop(.55, '#c4a6ff');
  lg.addColorStop(1, '#93c5fd');
  ctx.strokeStyle = lg;
  ctx.lineWidth = 2;
  ctx.shadowColor = 'rgba(214,158,255,.85)';
  ctx.shadowBlur = 8;
  ctx.stroke(linePath);
  ctx.shadowBlur = 0;

  // 末端亮点
  ctx.beginPath();
  ctx.arc(lastX, lastY, 3.2, 0, Math.PI * 2);
  ctx.fillStyle = '#ffd9f1';
  ctx.shadowColor = 'rgba(255,182,230,.95)';
  ctx.shadowBlur = 10;
  ctx.fill();
  ctx.shadowBlur = 0;
}

window.addEventListener('resize', drawTrend);

/* 底部音频均衡器跳动带（纯装饰） */
(function buildEq() {
  const eq = document.getElementById('eq');
  if (!eq || prefersReducedMotion()) return;
  let html = '';
  for (let i = 0; i < 44; i++) {
    html += '<i style="--a:' + (0.08 + Math.random() * 0.25).toFixed(2) +
      ';--b:' + (0.35 + Math.random() * 0.65).toFixed(2) +
      ';animation-duration:' + (0.5 + Math.random() * 0.9).toFixed(2) +
      's;animation-delay:-' + Math.random().toFixed(2) + 's"></i>';
  }
  eq.innerHTML = html;
})();

/* ---------- 最新投票 ---------- */
let lastFeedKey = '';
function renderFeed(latest) {
  if (!latest || !latest.length) {
    $feed.innerHTML = '<li class="feed-empty">暂无投票</li>';
    lastFeedKey = '';
    return;
  }
  const key = latest.map(x => x.ts + x.name).join('|');
  if (key === lastFeedKey) return;
  lastFeedKey = key;
  $feed.innerHTML = latest.map(x =>
    '<li><span><b>' + esc(x.name) + '</b> 收到投票</span><time>' + timeStr(x.ts) + '</time></li>'
  ).join('');
}

/* ---------- 总入口 ---------- */
function apply(d) {
  S = d;
  $title.textContent = d.title;
  $statusBadge.className = 'status-badge ' + d.status;
  $statusText.textContent = STATUS_TEXT[d.status] || d.status;
  countUp($totalVotes, d.totalVotes, Number($totalVotes.textContent.replace(/,/g, '')) || 0);
  // 票数变化时轻微跳动，给现场一个"又涨了"的信号
  if (prevTotalVotes != null && d.totalVotes !== prevTotalVotes && !prefersReducedMotion()) {
    $totalVotes.classList.remove('bump');
    void $totalVotes.offsetWidth;
    $totalVotes.classList.add('bump');
  }
  prevTotalVotes = d.totalVotes;
  $statContestants.textContent = d.contestantCount;
  if (d.deviceCount != null) $statDevices.textContent = fmt(d.deviceCount);

  if (d.lanUrl && d.lanUrl !== qrLast) {
    qrLast = d.lanUrl;   // 后台切换外网/局域网地址时，二维码实时跟随刷新
    $qrUrl.textContent = d.lanUrl;
    renderQR($qrBox, d.lanUrl, 5);
  }

  renderRanking(d.contestants);
  renderChart(d.contestants);
  renderFeed(d.latest);
  pushTrend(d.totalVotes);
}

connectEvents(apply);

// SSE 之外再做一次初始拉取，双保险
fetchJSON('/api/state').then(apply).catch(() => {});
