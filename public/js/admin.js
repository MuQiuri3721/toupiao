'use strict';

/* ================= 登录 ================= */

const $loginWrap = document.getElementById('loginWrap');
const $app = document.getElementById('app');
const $pwdInput = document.getElementById('pwdInput');
const $loginErr = document.getElementById('loginErr');

function token() { return sessionStorage.getItem('vv_token') || ''; }

async function api(path, body) {
  const opts = { headers: { 'x-admin-token': token() } };
  if (body !== undefined) {
    opts.method = 'POST';
    opts.headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(body);
  }
  try {
    return await fetchJSON(path, opts);
  } catch (e) {
    if (e.status === 401) { logout(); }
    throw e;
  }
}

function logout() {
  sessionStorage.removeItem('vv_token');
  $app.hidden = true;
  $loginWrap.hidden = false;
}

async function login() {
  $loginErr.textContent = '';
  try {
    const r = await fetchJSON('/api/admin/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: $pwdInput.value })
    });
    sessionStorage.setItem('vv_token', r.token);
    $pwdInput.value = '';
    enterApp();
  } catch (e) {
    $loginErr.textContent = e.message;
  }
}

document.getElementById('loginBtn').addEventListener('click', login);
$pwdInput.addEventListener('keydown', e => { if (e.key === 'Enter') login(); });
document.getElementById('logoutBtn').addEventListener('click', logout);

/* ================= 页签 ================= */

document.querySelectorAll('.tab').forEach(tab => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach(t => t.classList.toggle('active', t === tab));
    document.querySelectorAll('.tab-page').forEach(p => { p.hidden = p.id !== 'tab-' + tab.dataset.tab; });
  });
});

/* ================= 控制台 ================= */

let overview = null;

function renderOverview() {
  if (!overview) return;
  const { settings, stats, simulating, simSpeed } = overview;

  document.getElementById('stTotal').textContent = fmt(stats.totalVotes);
  document.getElementById('stContestants').textContent = stats.contestants;
  document.getElementById('stDevices').textContent = fmt(stats.devices);

  document.querySelectorAll('#statusSeg button').forEach(b => {
    b.classList.toggle('active', b.dataset.status === settings.status);
  });

  const simBtn = document.getElementById('simBtn');
  simBtn.classList.toggle('on', simulating);
  simBtn.textContent = simulating ? '⏹ 停止模拟投票' : '开启模拟投票';
  if (simulating) document.getElementById('simSpeed').value = simSpeed;

  const url = overview.lanUrl;
  document.getElementById('voteUrl').textContent = url;
  document.getElementById('openVote').href = url;
  renderQR(document.getElementById('qrMini'), url, 4);

  // 外网模式提示
  const pub = settings.publicUrl || '';
  document.getElementById('publicUrlInput').value = pub;
  document.getElementById('netModeHint').textContent = pub
    ? '✅ 当前已是外网模式：学生用手机流量、微信扫码均可访问（' + pub + '）'
    : '当前为局域网模式：仅同一 WiFi 内的手机能访问。';
  document.getElementById('linkHint').textContent = pub
    ? '学生扫码即可投票——手机流量、微信内打开都可以，无需连 WiFi。'
    : '学生手机连接同一个 WiFi，扫码或输入网址即可投票。';
}

document.getElementById('statusSeg').addEventListener('click', async e => {
  const btn = e.target.closest('button');
  if (!btn) return;
  try {
    await api('/api/admin/status', { status: btn.dataset.status });
    await loadOverview();
    toast('已切换状态', 'success');
  } catch (err) { toast(err.message, 'error'); }
});

document.getElementById('simBtn').addEventListener('click', async () => {
  const on = !document.getElementById('simBtn').classList.contains('on');
  try {
    await api('/api/admin/simulate', { on, speed: document.getElementById('simSpeed').value });
    await loadOverview();
    toast(on ? '模拟投票已开启，看看大屏效果吧！' : '模拟投票已停止', 'success');
  } catch (err) { toast(err.message, 'error'); }
});

document.getElementById('copyBtn').addEventListener('click', async () => {
  const url = document.getElementById('voteUrl').textContent;
  try {
    await navigator.clipboard.writeText(url);
    toast('已复制', 'success');
  } catch (_) {
    const input = document.createElement('input');
    input.value = url;
    document.body.appendChild(input);
    input.select();
    document.execCommand('copy');
    input.remove();
    toast('已复制', 'success');
  }
});

document.getElementById('savePublicUrl').addEventListener('click', async () => {
  const url = document.getElementById('publicUrlInput').value.trim();
  if (url && !/^https?:\/\//i.test(url)) { toast('地址需以 http:// 或 https:// 开头', 'error'); return; }
  try {
    await api('/api/admin/settings', { publicUrl: url });
    await loadOverview();
    toast(url ? '外网地址已保存，二维码已切换为公网版' : '已清除，回到仅局域网模式', 'success');
  } catch (e) { toast(e.message, 'error'); }
});

document.getElementById('clearPublicUrl').addEventListener('click', async () => {
  document.getElementById('publicUrlInput').value = '';
  try {
    await api('/api/admin/settings', { publicUrl: '' });
    await loadOverview();
    toast('已清除，回到仅局域网模式', 'success');
  } catch (e) { toast(e.message, 'error'); }
});

document.getElementById('exportBtn').addEventListener('click', async () => {
  try {
    const res = await fetch('/api/admin/export', { headers: { 'x-admin-token': token() } });
    if (!res.ok) throw new Error('导出失败');
    const blob = await res.blob();
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = '投票结果.csv';
    a.click();
    URL.revokeObjectURL(a.href);
  } catch (e) { toast(e.message, 'error'); }
});

document.getElementById('resetBtn').addEventListener('click', async () => {
  if (!confirm('确定清空所有票数吗？\n所有选手票数归零、设备投票记录清空，用于开启新一轮。')) return;
  try {
    await api('/api/admin/reset', {});
    await loadOverview();
    toast('已清空，可以开始新一轮了', 'success');
  } catch (e) { toast(e.message, 'error'); }
});

async function loadOverview() {
  overview = await api('/api/admin/overview');
  renderOverview();
  return overview;
}

/* ================= 选手管理 ================= */

const $cList = document.getElementById('cList');
const $fName = document.getElementById('fName');
const $fClass = document.getElementById('fClass');
const $fSong = document.getElementById('fSong');
const $photoPreview = document.getElementById('photoPreview');
const $photoClear = document.getElementById('photoClear');
let editId = null;       // null=新增
let editPhoto = undefined; // undefined=不变, null=移除, dataURL=新照片

function renderContestants(list) {
  document.getElementById('cCount').textContent = list.length;
  if (!list.length) {
    $cList.innerHTML = '<p class="hint">还没有选手，用上方表单添加，或直接开始演示（内置 12 名示例选手）。</p>';
    return;
  }
  $cList.innerHTML = list.map(c => {
    const avatar = c.photo
      ? '<img src="/api/photo/' + c.id + '?v=' + c.updatedAt + '" alt="">'
      : esc((c.name || '?').slice(0, 1));
    return (
      '<div class="c-item">' +
        '<div class="c-avatar" style="background:' + avatarColor(c.name) + '">' + avatar + '</div>' +
        '<div class="c-main">' +
          '<div class="c-name">' + esc(c.name) + '</div>' +
          '<div class="c-sub">' + esc(c.className) + (c.song ? ' · 《' + esc(c.song) + '》' : '') + '</div>' +
        '</div>' +
        '<div class="c-votes"><b>' + fmt(c.votes) + '</b> 票</div>' +
        '<div class="c-actions">' +
          '<button class="btn-ghost small" data-edit="' + c.id + '">编辑</button>' +
          '<button class="btn-ghost small" data-del="' + c.id + '">删除</button>' +
        '</div>' +
      '</div>'
    );
  }).join('');
}

$cList.addEventListener('click', async e => {
  const editBtn = e.target.closest('[data-edit]');
  const delBtn = e.target.closest('[data-del]');
  if (editBtn) {
    const c = overview.contestants.find(x => x.id === editBtn.dataset.edit);
    if (!c) return;
    editId = c.id;
    editPhoto = undefined;
    $fName.value = c.name;
    $fClass.value = c.className;
    $fSong.value = c.song;
    showPhotoPreview(c.photo);
    document.getElementById('formTitle').textContent = '编辑选手：' + c.name;
    document.getElementById('saveContestant').textContent = '保存修改';
    document.getElementById('cancelEdit').hidden = false;
    document.getElementById('tab-contestants').scrollIntoView({ behavior: 'smooth' });
  }
  if (delBtn) {
    const c = overview.contestants.find(x => x.id === delBtn.dataset.del);
    if (!c) return;
    if (!confirm('确定删除选手「' + c.name + '」吗？该选手的票数将一并删除。')) return;
    try {
      await api('/api/admin/contestant-delete', { id: c.id });
      await loadOverview();
      toast('已删除', 'success');
    } catch (err) { toast(err.message, 'error'); }
  }
});

function showPhotoPreview(photo) {
  $photoPreview.innerHTML = photo
    ? '<img src="' + photo + '" alt="">'
    : '照片';
  $photoClear.hidden = !photo;
}

document.getElementById('photoPick').addEventListener('click', () => document.getElementById('photoInput').click());

document.getElementById('photoInput').addEventListener('change', e => {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;
  resizeImage(file).then(dataUrl => {
    editPhoto = dataUrl;
    showPhotoPreview(dataUrl);
  }).catch(() => toast('图片读取失败', 'error'));
});

$photoClear.addEventListener('click', () => {
  editPhoto = null;
  showPhotoPreview(null);
});

/* 压缩图片：最长边 360px，JPEG 85% */
function resizeImage(file, max) {
  max = max || 360;
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        const scale = Math.min(1, max / Math.max(img.width, img.height));
        const w = Math.round(img.width * scale);
        const h = Math.round(img.height * scale);
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        canvas.getContext('2d').drawImage(img, 0, 0, w, h);
        resolve(canvas.toDataURL('image/jpeg', 0.85));
      };
      img.onerror = reject;
      img.src = reader.result;
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function resetForm() {
  editId = null;
  editPhoto = undefined;
  $fName.value = '';
  $fClass.value = '';
  $fSong.value = '';
  showPhotoPreview(null);
  document.getElementById('formTitle').textContent = '添加选手';
  document.getElementById('saveContestant').textContent = '保存';
  document.getElementById('cancelEdit').hidden = true;
}

document.getElementById('cancelEdit').addEventListener('click', resetForm);

document.getElementById('saveContestant').addEventListener('click', async () => {
  const name = $fName.value.trim();
  if (!name) { toast('请填写选手姓名', 'error'); return; }
  const payload = { name, className: $fClass.value.trim(), song: $fSong.value.trim() };
  try {
    if (editId) {
      if (editPhoto !== undefined) payload.photo = editPhoto;
      await api('/api/admin/contestant-update', Object.assign({ id: editId }, payload));
      toast('已保存修改', 'success');
    } else {
      if (editPhoto !== undefined) payload.photo = editPhoto;
      await api('/api/admin/contestant-add', payload);
      toast('已添加「' + name + '」', 'success');
    }
    resetForm();
    await loadOverview();
  } catch (err) { toast(err.message, 'error'); }
});

/* ================= 系统设置 ================= */

function fillSettings() {
  if (!overview) return;
  document.getElementById('setTitle').value = overview.settings.title;
  document.getElementById('setVotes').value = overview.settings.votesPerDevice;
  document.getElementById('setRepeat').checked = overview.settings.allowRepeat;
}

document.getElementById('saveSettings').addEventListener('click', async () => {
  const votes = Number(document.getElementById('setVotes').value);
  if (!Number.isInteger(votes) || votes < 1 || votes > 99) { toast('每人可投票数需为 1-99 的整数', 'error'); return; }
  try {
    await api('/api/admin/settings', {
      title: document.getElementById('setTitle').value.trim(),
      votesPerDevice: votes,
      allowRepeat: document.getElementById('setRepeat').checked
    });
    await loadOverview();
    toast('设置已保存', 'success');
  } catch (e) { toast(e.message, 'error'); }
});

document.getElementById('savePassword').addEventListener('click', async () => {
  const oldPw = document.getElementById('pwOld').value;
  const newPw = document.getElementById('pwNew').value;
  if (newPw.length < 4) { toast('新密码至少 4 位', 'error'); return; }
  try {
    const r = await api('/api/admin/password', { old: oldPw, next: newPw });
    sessionStorage.setItem('vv_token', r.token);
    document.getElementById('pwOld').value = '';
    document.getElementById('pwNew').value = '';
    toast('密码已修改', 'success');
  } catch (e) { toast(e.message, 'error'); }
});

/* ================= 启动 ================= */

async function enterApp() {
  $loginWrap.hidden = true;
  $app.hidden = false;
  try {
    await loadOverview();
    fillSettings();
    renderContestants(overview.contestants);
  } catch (_) { /* 401 已在 api() 中处理 */ }
}

// overview 刷新后同步选手列表
const _origLoad = loadOverview;
loadOverview = async function () {
  const o = await _origLoad();
  renderContestants(o.contestants);
  return o;
};

// 自动登录：已存 token 则直接进入
(async function boot() {
  if (!token()) return;
  try {
    await enterApp();
  } catch (_) {
    logout();
  }
})();
