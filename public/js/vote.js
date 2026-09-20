'use strict';

let S = null;   // 最新公共数据
let mine = { used: 0, remaining: 0, votedIds: [] };
let voting = false;   // 防连点
let firstListRender = true;   // 首次渲染播放入场动画

const $title = document.getElementById('title');
const $statusPill = document.getElementById('statusPill');
const $statusText = document.getElementById('statusText');
const $banner = document.getElementById('banner');
const $chips = document.getElementById('chips');
const $remaining = document.getElementById('remaining');
const $total = document.getElementById('total');
const $list = document.getElementById('list');

const STATUS_TEXT = { ready: '未开始', open: '投票进行中', ended: '已结束' };

async function refresh() {
  try {
    const d = await fetchJSON('/api/state?device=' + encodeURIComponent(getDeviceId()));
    S = d;
    mine = d.device;
    if (!Array.isArray(mine.votedIds)) mine.votedIds = [];
    render();
  } catch (e) {
    toast('连接服务器失败，正在重试…', 'error');
    setTimeout(refresh, 2000);
  }
}

function renderBanner() {
  if (S.status === 'ready') {
    $banner.hidden = false;
    $banner.className = 'banner';
    $banner.textContent = '⏳ 投票尚未开始，先看看都有哪些选手吧！';
  } else if (S.status === 'ended') {
    $banner.hidden = false;
    $banner.className = 'banner ended';
    $banner.textContent = '🏁 投票已结束，感谢大家的热情参与！';
  } else {
    $banner.hidden = true;
  }
}

function renderChips() {
  $total.textContent = S.votesPerDevice;
  $remaining.textContent = mine.remaining;
  let chips = '';
  for (let i = 0; i < S.votesPerDevice; i++) {
    chips += '<span class="chip' + (i < mine.used ? ' used' : '') + '"></span>';
  }
  $chips.innerHTML = chips;
}

function buttonState(c) {
  if (S.status !== 'open') return { label: S.status === 'ready' ? '未开始' : '已结束', cls: '', disabled: true };
  if (mine.remaining <= 0) return { label: '票数已用完', cls: '', disabled: true };
  if (!S.allowRepeat && mine.votedIds.includes(c.id)) return { label: '已投TA ✓', cls: 'voted', disabled: true };
  return { label: '投TA一票', cls: '', disabled: false };
}

function renderList() {
  if (!S.contestants.length) {
    $list.innerHTML = '<div class="empty">暂无选手信息</div>';
    return;
  }
  // 展示顺序保持添加顺序，方便选手找到自己；名次实时标注在名字旁
  const rankMap = {};
  S.contestants.forEach((c, i) => { rankMap[c.id] = i + 1; });
  const enter = firstListRender;   // 仅首次加载播放入场动画
  $list.innerHTML = S.contestants.map((c, i) => {
    const st = buttonState(c);
    const rk = rankMap[c.id];
    const photo = c.photoRev
      ? '<img src="/api/photo/' + c.id + '?v=' + c.photoRev + '" alt="">'
      : esc((c.name || '?').slice(0, 1));
    return (
      '<div class="card' + (enter ? ' vote-enter' : '') + '" id="card-' + c.id + '"' +
        (enter ? ' style="--i:' + i + '"' : '') + '>' +
        '<div class="avatar" style="background:' + avatarColor(c.name) + '">' + photo + '</div>' +
        '<div class="info">' +
          '<div class="name-row"><span class="name">' + esc(c.name) + '</span>' +
          '<span class="rank-badge' + (rk <= 3 ? ' t' + rk : '') + '" data-id="' + c.id + '">#' + rk + '</span>' +
          '<span class="klass">' + esc(c.className) + '</span></div>' +
          '<div class="song">' + esc(c.song) + '</div>' +
          '<div class="votes-row">' +
            '<span class="votes" id="votes-' + c.id + '"><b>' + fmt(c.votes) + '</b>票</span>' +
            '<button class="vote-btn ' + st.cls + '" data-id="' + c.id + '"' + (st.disabled ? ' disabled' : '') + '>' + st.label + '</button>' +
          '</div>' +
        '</div>' +
      '</div>'
    );
  }).join('');
  firstListRender = false;
}

/* 投票成功的小粒子 */
function spawnBurst(container) {
  if (prefersReducedMotion()) return;
  for (let i = 0; i < 8; i++) {
    const s = document.createElement('i');
    s.className = 'spark';
    const ang = Math.random() * Math.PI * 2;
    const dist = 26 + Math.random() * 26;
    s.style.setProperty('--dx', (Math.cos(ang) * dist).toFixed(1) + 'px');
    s.style.setProperty('--dy', (Math.sin(ang) * dist - 12).toFixed(1) + 'px');
    container.appendChild(s);
    setTimeout(() => s.remove(), 750);
  }
}

function render() {
  if (!S) return;
  $title.textContent = S.title;
  $statusPill.className = 'status-pill ' + S.status;
  $statusText.textContent = STATUS_TEXT[S.status] || S.status;
  renderBanner();
  renderChips();
  renderList();
}

/* SSE：别人投票时，票数原地跳动，不重建整页 */
const $connBadge = document.getElementById('connBadge');
connectEvents(d => {
  if (d.type !== 'sync') return;
  const prevVotes = {};
  if (S) for (const c of S.contestants) prevVotes[c.id] = c.votes;
  // 紧凑帧：只含最新票数，合并进本地已知选手数据并重新排序
  if (d.compact && S) {
    for (const c of S.contestants) {
      if (d.votes && d.votes[c.id] != null) c.votes = d.votes[c.id];
    }
    d.contestants = S.contestants.slice().sort((a, b) => b.votes - a.votes || a.id.localeCompare(b.id));
    d.latest = d.latest || S.latest;
  }
  const statusChanged = !S || S.status !== d.status;
  S = d;
  $statusPill.className = 'status-pill ' + S.status;
  $statusText.textContent = STATUS_TEXT[S.status] || S.status;
  renderBanner();
  for (const c of S.contestants) {
    const el = document.getElementById('votes-' + c.id);
    if (el) countUp(el.querySelector('b'), c.votes, prevVotes[c.id]);
  }
  // 实时名次徽章
  const rankMap = {};
  S.contestants.forEach((c, i) => { rankMap[c.id] = i + 1; });
  document.querySelectorAll('.rank-badge').forEach(b => {
    const rk = rankMap[b.dataset.id];
    if (rk) {
      b.textContent = '#' + rk;
      b.className = 'rank-badge' + (rk <= 3 ? ' t' + rk : '');
    }
  });
  // 规则/状态变化会影响按钮，此时重建列表；纯票数变化保持页面稳定
  if (statusChanged) renderList();
}, ok => { if ($connBadge) $connBadge.hidden = ok; });

/* 投票 */
$list.addEventListener('click', async e => {
  const btn = e.target.closest('.vote-btn');
  if (!btn || btn.disabled || voting) return;
  voting = true;
  btn.disabled = true;
  const cid = btn.dataset.id;
  try {
    const r = await fetchJSON('/api/vote', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ deviceId: getDeviceId(), contestantId: cid })
    });
    mine.used = r.used;
    mine.remaining = r.remaining;
    if (S && !S.allowRepeat && !mine.votedIds.includes(cid)) mine.votedIds.push(cid);

    // 局部更新：该选手票数 +1 飘字 + 粒子迸发
    const votesEl = document.getElementById('votes-' + cid);
    if (votesEl) {
      const b = votesEl.querySelector('b');
      countUp(b, r.votes, Number(b.textContent.replace(/,/g, '')) || 0);
      const pop = document.createElement('span');
      pop.className = 'plus-one';
      pop.textContent = '+1';
      votesEl.appendChild(pop);
      setTimeout(() => pop.remove(), 850);
      spawnBurst(votesEl);
    }
    // 该按钮即时反馈
    if (S && !S.allowRepeat) {
      btn.textContent = '已投TA ✓';
      btn.classList.add('voted');
    }
    // 剩余票数与全部按钮状态
    renderChips();
    if (mine.remaining <= 0) {
      document.querySelectorAll('.vote-btn:not(.voted)').forEach(b => {
        b.disabled = true;
        b.textContent = '票数已用完';
      });
    } else {
      btn.disabled = false;
    }
    toast('投票成功！', 'success');
  } catch (err) {
    toast(err.message, 'error');
    if (/用完/.test(err.message)) mine.remaining = 0;
    if (!S || S.status === 'open') render();   // 出错时整体校准一次
  }
  voting = false;
});

refresh();
