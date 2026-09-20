/**
 * 校园十佳歌手 · 实时投票系统
 * 零依赖：仅需 Node.js（无需 npm install）    启动：node server.js
 * 实时推送使用 SSE（Server-Sent Events），数据持久化到 data/data.json
 */
'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');

const PORT = Number(process.env.PORT) || 3000;
const ROOT = __dirname;
const PUBLIC_DIR = path.join(ROOT, 'public');
const DATA_DIR = path.join(ROOT, 'data');
const DATA_FILE = path.join(DATA_DIR, 'data.json');
const BACKUP_FILE = path.join(DATA_DIR, 'data.backup.json');
const VOTELOG_FILE = path.join(DATA_DIR, 'votes.log');

/* ============================== 数据 ============================== */

// 预置示例选手，正式使用时在管理后台修改即可
const DEFAULT_CONTESTANTS = [
  ['林晓萌', '高二(3)班', '起风了'],
  ['陈宇航', '高一(5)班', '平凡之路'],
  ['苏雨桐', '高二(7)班', '光年之外'],
  ['王一诺', '高三(1)班', '海阔天空'],
  ['李思远', '高二(2)班', '成都'],
  ['赵梓萱', '高一(8)班', '隐形的翅膀'],
  ['周子墨', '高三(6)班', '李白'],
  ['许安琪', '高二(4)班', '后来'],
  ['郑天佑', '高一(1)班', '夜空中最亮的星'],
  ['沈梦洁', '高三(2)班', '追光者'],
  ['韩明轩', '高二(9)班', '演员'],
  ['顾语嫣', '高一(3)班', '小幸运'],
];

let state = null;
let adminToken = null;

function defaultState() {
  const now = Date.now();
  return {
    nextId: DEFAULT_CONTESTANTS.length + 1,
    settings: {
      title: '校园十佳歌手大赛',
      status: 'ready',        // ready 未开始 | open 投票中 | ended 已结束
      votesPerDevice: 3,      // 每台设备总共可投的票数
      allowRepeat: true,      // 是否允许多票投给同一位选手
      publicUrl: '',          // 外网访问地址（内网穿透后填写，留空=仅局域网）
      adminPassword: '123456' // 管理后台密码，后台可修改
    },
    contestants: DEFAULT_CONTESTANTS.map((c, i) => ({
      id: 'c' + (i + 1),
      name: c[0],
      className: c[1],
      song: c[2],
      photo: null,
      votes: 0,
      updatedAt: now
    })),
    devices: {},   // deviceId -> { used, targets: {contestantId: n} }
    latest: [],    // 最近投票记录 [{ name, ts }]
    voteLog: []    // 真实投票审计日志 [{ t, d(设备指纹), c(选手id) }]，模拟投票不记录
  };
}

function loadData() {
  try {
    const raw = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
    const def = defaultState();
    state = Object.assign(def, raw);
    state.settings = Object.assign(defaultState().settings, raw.settings || {});
    if (!Array.isArray(state.contestants)) state.contestants = [];
    if (!state.devices || typeof state.devices !== 'object') state.devices = {};
    if (!Array.isArray(state.latest)) state.latest = [];
    if (!Array.isArray(state.voteLog)) state.voteLog = [];
  } catch (err) {
    // 主文件损坏时尝试从备份恢复
    let recovered = false;
    try {
      const raw = JSON.parse(fs.readFileSync(BACKUP_FILE, 'utf8'));
      state = Object.assign(defaultState(), raw);
      state.settings = Object.assign(defaultState().settings, raw.settings || {});
      recovered = true;
    } catch (_) {}
    if (!recovered) state = defaultState();
    console.error('[数据] 读取 data.json 失败(' + err.message + ')' +
      (recovered ? '，已从备份 data.backup.json 恢复' : '，使用全新数据'));
  }
  if (!Array.isArray(state.voteLog)) state.voteLog = [];
  // 投票明细单独存文件（追加写，重启时读回）
  try {
    if (fs.existsSync(VOTELOG_FILE)) {
      const rows = fs.readFileSync(VOTELOG_FILE, 'utf8').split('\n');
      state.voteLog = [];
      for (const line of rows) {
        if (!line.trim()) continue;
        try { state.voteLog.push(JSON.parse(line)); } catch (_) {}
      }
    }
  } catch (_) {}
  refreshAdminToken();
}

let saveTimer = null;
let lastBackupAt = 0;
function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveNow, 300);
}
function saveNow() {
  clearTimeout(saveTimer);
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    // voteLog 单独存放，data.json 保持小体积；备份最多 30 秒一次
    const body = JSON.stringify(state, (k, v) => (k === 'voteLog' ? undefined : v), 1);
    if (fs.existsSync(DATA_FILE) && Date.now() - lastBackupAt > 30000) {
      fs.copyFileSync(DATA_FILE, BACKUP_FILE);
      lastBackupAt = Date.now();
    }
    fs.writeFileSync(DATA_FILE, body);
  } catch (e) {
    console.error('[数据保存失败]', e.message);
  }
}

function appendVoteLog(entry) {
  try {
    fs.appendFileSync(VOTELOG_FILE, JSON.stringify(entry) + '\n');
  } catch (e) { console.error('[日志写入失败]', e.message); }
}

function refreshAdminToken() {
  adminToken = crypto.createHash('sha256')
    .update('vv-admin|' + state.settings.adminPassword)
    .digest('hex');
}

/* ============================== 实时推送（SSE） ============================== */

const sseClients = new Set();
let dirty = false;
let lastBroadcastAt = 0;

// 推送节流：按在线观众规模自适应刷新间隔（人越多越省带宽，依然保持实时感）
function broadcastInterval() {
  const n = sseClients.size;
  if (n > 200) return 800;
  if (n > 60) return 400;
  return 150;
}
setInterval(() => {
  if (!dirty) return;
  if (Date.now() - lastBroadcastAt < broadcastInterval()) return;
  dirty = false;
  lastBroadcastAt = Date.now();
  pushToAll();
}, 100);

// 心跳，防止中间设备断开空闲连接
setInterval(() => {
  for (const res of sseClients) {
    try { res.write(': hb\n\n'); } catch (_) { sseClients.delete(res); }
  }
}, 25000);

function lanAddress() {
  const ifs = os.networkInterfaces();
  // 打分挑选最像“真局域网”的网卡：跳过回环/链路本地，
  // 校园网常见 10.x 优先，192.168 次之；以 .1 结尾的多为虚拟网卡/网关，降权
  let best = '', bestScore = -1;
  for (const list of Object.values(ifs)) {
    for (const it of list || []) {
      if (it.family !== 'IPv4' || it.internal) continue;
      const a = it.address;
      if (/^169\.254\./.test(a) || /^198\.18\./.test(a)) continue;
      let sc = 1;
      if (/^192\.168\./.test(a)) sc = 2.5;
      if (/^172\.(1[6-9]|2\d|3[01])\./.test(a)) sc = 3;
      if (/^10\./.test(a)) sc = 3;
      if (/\.1$/.test(a)) sc -= 1;
      if (sc > bestScore) { bestScore = sc; best = a; }
    }
  }
  return best || '127.0.0.1';
}

/* ============================== 部署模式（可选 config.json） ============================== */
// 云服务器部署时，在项目根目录创建 config.json：{"mode":"cloud"}
// 系统会自动识别服务器公网 IP 并用于二维码/地址（学生用流量也能访问）
let config = {};
try { config = JSON.parse(fs.readFileSync(path.join(ROOT, 'config.json'), 'utf8')); } catch (_) {}
const CLOUD_MODE = config.mode === 'cloud';

let publicIp = '';
async function detectPublicIp() {
  const endpoints = [
    ['https://ip.3322.net', t => t.trim()],
    ['https://myip.ipip.net', t => (t.match(/(\d{1,3}(?:\.\d{1,3}){3})/) || [])[1] || ''],
    ['https://api.ipify.org?format=json', t => { try { return JSON.parse(t).ip; } catch (_) { return ''; } }]
  ];
  for (const [url, parse] of endpoints) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
      const ip = parse(await res.text());
      if (/^\d{1,3}(\.\d{1,3}){3}$/.test(ip)) return ip;
    } catch (_) {}
  }
  return '';
}
async function ensurePublicIp() {
  if (!CLOUD_MODE || publicIp) return;
  publicIp = await detectPublicIp();
  if (publicIp) {
    console.log('[网络] 云模式：已识别公网 IP ' + publicIp + '，二维码/地址已切换为公网版');
    pushToAll();
  } else {
    console.log('[网络] 云模式：公网 IP 识别失败，稍后自动重试');
  }
}
ensurePublicIp();
setInterval(ensurePublicIp, 300000);   // 未识别成功则每 5 分钟重试

function voteBaseUrl() {
  // 优先级：后台手动填写的地址 > 云模式自动识别的公网 IP > 局域网地址
  const pub = String(state.settings.publicUrl || '').trim().replace(/\/+$/, '');
  if (pub) return pub;
  if (CLOUD_MODE && publicIp) return 'http://' + publicIp + ':' + PORT;
  return 'http://' + lanAddress() + ':' + PORT;
}

function snapshot() {
  const sorted = [...state.contestants].sort((a, b) => b.votes - a.votes || a.id.localeCompare(b.id));
  const total = state.contestants.reduce((s, c) => s + c.votes, 0);
  return {
    type: 'sync',
    title: state.settings.title,
    status: state.settings.status,
    votesPerDevice: state.settings.votesPerDevice,
    allowRepeat: state.settings.allowRepeat,
    publicMode: !!String(state.settings.publicUrl || '').trim() || !!(CLOUD_MODE && publicIp),
    totalVotes: total,
    contestantCount: state.contestants.length,
    deviceCount: Object.keys(state.devices).length,
    contestants: sorted.map(c => ({
      id: c.id, name: c.name, className: c.className, song: c.song, votes: c.votes,
      photoRev: c.photo ? c.updatedAt : 0
    })),
    latest: state.latest.slice(0, 8),
    lanUrl: voteBaseUrl() + '/'
  };
}

// 紧凑增量广播：只推每个选手的最新票数（载荷约为全量的 1/6，500 人在线也省带宽）
function compactSnapshot() {
  const votes = {};
  for (const c of state.contestants) votes[c.id] = c.votes;
  const total = state.contestants.reduce((s, c) => s + c.votes, 0);
  return {
    type: 'sync',
    compact: true,
    title: state.settings.title,
    status: state.settings.status,
    votesPerDevice: state.settings.votesPerDevice,
    allowRepeat: state.settings.allowRepeat,
    publicMode: !!String(state.settings.publicUrl || '').trim() || !!(CLOUD_MODE && publicIp),
    totalVotes: total,
    contestantCount: state.contestants.length,
    deviceCount: Object.keys(state.devices).length,
    votes,
    latest: state.latest.slice(0, 8),
    lanUrl: voteBaseUrl() + '/'
  };
}

let structureDirty = false;   // 选手增删改/标题等结构性变化 → 下次广播改发全量

function pushToAll() {
  const snap = structureDirty ? snapshot() : compactSnapshot();
  structureDirty = false;
  const payload = 'data: ' + JSON.stringify(snap) + '\n\n';
  for (const res of sseClients) {
    try { res.write(payload); } catch (_) { sseClients.delete(res); }
  }
}

/* ============================== 投票逻辑 ============================== */

// 同一 IP 限速：学校 WiFi 下大量手机可能共用出口 IP，所以给很大的上限，只拦截脚本式刷票
const ipCounters = new Map();
function ipAllowed(ip) {
  const now = Date.now();
  let rec = ipCounters.get(ip);
  if (!rec || now - rec.start > 60000) {
    rec = { start: now, n: 0 };
    ipCounters.set(ip, rec);
  }
  rec.n++;
  return rec.n <= 3000;
}

function castVote(cid, deviceId, ip) {
  const s = state.settings;
  if (s.status !== 'open') {
    return { code: 403, error: s.status === 'ready' ? '投票尚未开始，请稍候~' : '投票已结束，感谢参与！' };
  }
  if (!deviceId || typeof deviceId !== 'string' || deviceId.length > 64) {
    return { code: 400, error: '设备信息异常' };
  }
  if (!ipAllowed(ip)) return { code: 429, error: '操作太频繁啦，稍后再试' };
  const c = state.contestants.find(x => x.id === cid);
  if (!c) return { code: 404, error: '选手不存在' };

  const dev = state.devices[deviceId] || (state.devices[deviceId] = { used: 0, targets: {} });
  if (dev.used >= s.votesPerDevice) return { code: 403, error: '你的票数已经用完啦，谢谢支持！' };
  if (!s.allowRepeat && dev.targets[cid]) return { code: 403, error: '每位选手只能投一票哦' };

  dev.used++;
  dev.targets[cid] = (dev.targets[cid] || 0) + 1;
  c.votes++;
  state.latest.unshift({ name: c.name, ts: Date.now() });
  state.latest = state.latest.slice(0, 10);
  // 审计日志：设备指纹只存哈希前 10 位（可对账、不泄露原 ID），上限 2 万条
  const entry = {
    t: Date.now(),
    d: crypto.createHash('sha256').update(deviceId).digest('hex').slice(0, 10),
    c: cid
  };
  state.voteLog.push(entry);
  if (state.voteLog.length > 20000) state.voteLog.splice(0, state.voteLog.length - 20000);
  appendVoteLog(entry);
  dirty = true;
  save();
  return {
    code: 200,
    data: {
      used: dev.used,
      remaining: Math.max(0, s.votesPerDevice - dev.used),
      votes: c.votes
    }
  };
}

/* ============================== 演示模拟投票 ============================== */

let simTimer = null;
let simSpeed = 'medium';
const SIM_DELAY = { slow: [900, 2200], medium: [250, 800], fast: [60, 240] };

function simulateOnce() {
  const cs = state.contestants;
  if (!cs.length) return;
  const c = cs[Math.floor(Math.random() * cs.length)];
  c.votes++;
  state.latest.unshift({ name: c.name, ts: Date.now() });
  state.latest = state.latest.slice(0, 10);
  dirty = true;
  save();
}

function setSimulate(on, speed) {
  if (speed && SIM_DELAY[speed]) simSpeed = speed;
  clearTimeout(simTimer);
  if (on) tickSim();
  save();
  return { on: !!on, speed: simSpeed };
}

function tickSim() {
  simulateOnce();
  const [a, b] = SIM_DELAY[simSpeed];
  simTimer = setTimeout(tickSim, a + Math.random() * (b - a));
}

/* ============================== HTTP 服务 ============================== */

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2'
};

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', ch => {
      size += ch.length;
      if (size > 8 * 1024 * 1024) { reject(new Error('请求体过大')); req.destroy(); return; }
      chunks.push(ch);
    });
    req.on('end', () => {
      if (!chunks.length) return resolve({});
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
      catch (_) { resolve({}); }
    });
    req.on('error', reject);
  });
}

function json(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(body);
}

function isAdmin(req) {
  return req.headers['x-admin-token'] === adminToken;
}

const zlib = require('zlib');

const staticCache = new Map();   // filePath -> { mtimeMs, raw, gz, lastModified }

function serveFile(req, res, filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const compressible = ['.html', '.js', '.css', '.json', '.svg'].includes(ext);
  let stat;
  try { stat = fs.statSync(filePath); } catch (_) { res.writeHead(404); res.end(); return; }

  // 协商缓存：文件没变直接 304，几百字节搞定一次页面加载
  const lastModified = new Date(Math.floor(stat.mtimeMs / 1000) * 1000).toUTCString();
  const ims = req.headers['if-modified-since'];
  if (ims && new Date(ims).getTime() === Math.floor(stat.mtimeMs / 1000) * 1000) {
    res.writeHead(304, { 'Last-Modified': lastModified });
    res.end();
    return;
  }

  // html/js/css 每次向服务器校验新鲜度（改动即时生效，未变则 304 秒回）
  const cache = compressible
    ? 'no-cache'
    : 'public, max-age=3600';
  const headers = {
    'Content-Type': MIME[ext] || 'application/octet-stream',
    'Cache-Control': cache,
    'Last-Modified': lastModified
  };

  if (compressible) {
    let entry = staticCache.get(filePath);
    if (!entry || entry.mtimeMs !== stat.mtimeMs) {
      const raw = fs.readFileSync(filePath);
      entry = { mtimeMs: stat.mtimeMs, raw, gz: zlib.gzipSync(raw, { level: 6 }) };
      if (staticCache.size > 60) staticCache.clear();
      staticCache.set(filePath, entry);
    }
    if ((req.headers['accept-encoding'] || '').includes('gzip')) {
      headers['Content-Encoding'] = 'gzip';
      headers['Content-Length'] = entry.gz.length;
      res.writeHead(200, headers);
      res.end(entry.gz);
      return;
    }
    headers['Content-Length'] = entry.raw.length;
    res.writeHead(200, headers);
    res.end(entry.raw);
    return;
  }

  // 图片等大文件照旧流式发送
  res.writeHead(200, headers);
  fs.createReadStream(filePath).pipe(res);
}

function serveStatic(req, res, pathname) {
  let p = pathname === '/' ? '/vote.html' : pathname;
  if (p === '/screen') p = '/screen.html';
  if (p === '/admin') p = '/admin.html';
  const fp = path.normalize(path.join(PUBLIC_DIR, decodeURIComponent(p)));
  if (!fp.startsWith(PUBLIC_DIR) || !fs.existsSync(fp) || !fs.statSync(fp).isFile()) {
    res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end('<meta charset="utf-8"><body style="font-family:sans-serif;text-align:center;padding-top:80px"><h1>404</h1><p>页面不存在</p><p><a href="/">返回投票页</a></p></body>');
    return;
  }
  serveFile(req, res, fp);
}

function handleSSE(req, res) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no'
  });
  res.write(': connected\n\n');
  res.write('data: ' + JSON.stringify(snapshot()) + '\n\n');
  sseClients.add(res);
  req.on('close', () => sseClients.delete(res));
}

const photoCache = new Map();   // id@updatedAt -> Buffer，避免每次请求重复解码 base64

function handlePhoto(res, id) {
  const c = state.contestants.find(x => x.id === id);
  if (!c || !c.photo || !c.photo.startsWith('data:')) {
    res.writeHead(404); res.end(); return;
  }
  const m = c.photo.match(/^data:(image\/[a-z+]+);base64,(.+)$/);
  if (!m) { res.writeHead(404); res.end(); return; }
  const key = id + '@' + c.updatedAt;
  let buf = photoCache.get(key);
  if (!buf) {
    buf = Buffer.from(m[2], 'base64');
    if (photoCache.size > 120) photoCache.clear();
    photoCache.set(key, buf);
  }
  res.writeHead(200, {
    'Content-Type': m[1],
    'Cache-Control': 'public, max-age=86400'
  });
  res.end(buf);
}

function exportCSV(res) {
  const sorted = [...state.contestants].sort((a, b) => b.votes - a.votes);
  const rows = [['名次', '姓名', '班级', '曲目', '票数']];
  sorted.forEach((c, i) => rows.push([String(i + 1), c.name, c.className, c.song, String(c.votes)]));
  // 追加真实投票明细（审计用），模拟投票不计入
  rows.push([]);
  rows.push(['投票明细', '共 ' + state.voteLog.length + ' 条']);
  rows.push(['时间', '设备指纹', '选手']);
  const nameOf = id => { const c = state.contestants.find(x => x.id === id); return c ? c.name : id; };
  for (const v of state.voteLog) {
    rows.push([new Date(v.t).toLocaleString('zh-CN'), v.d, nameOf(v.c)]);
  }
  const csv = '\uFEFF' + rows.map(r => r.map(v => '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"').join(',')).join('\r\n');
  res.writeHead(200, {
    'Content-Type': 'text/csv; charset=utf-8',
    'Content-Disposition': 'attachment; filename="votes.csv"'
  });
  res.end(csv);
}

async function handleAdmin(req, res, pathname, query) {
  const body = req.method === 'POST' ? await readBody(req) : {};
  const s = state.settings;

  // 登录
  if (pathname === '/api/admin/login') {
    if (body.password === s.adminPassword) {
      refreshAdminToken();
      return json(res, 200, { ok: true, token: adminToken });
    }
    return json(res, 401, { error: '密码错误' });
  }

  if (!isAdmin(req)) return json(res, 401, { error: '请先登录' });

  switch (pathname) {
    case '/api/admin/overview': {
      const total = state.contestants.reduce((sum, c) => sum + c.votes, 0);
      return json(res, 200, {
        settings: {
          title: s.title, status: s.status,
          votesPerDevice: s.votesPerDevice, allowRepeat: s.allowRepeat,
          publicUrl: s.publicUrl || ''
        },
        contestants: [...state.contestants].sort((a, b) => b.votes - a.votes),
        stats: {
          totalVotes: total,
          contestants: state.contestants.length,
          devices: Object.keys(state.devices).length,
          realVotes: state.voteLog.length
        },
        lanUrl: voteBaseUrl() + '/',
        publicMode: !!String(s.publicUrl || '').trim() || !!(CLOUD_MODE && publicIp),
        simulating: !!simTimer,
        simSpeed
      });
    }

    case '/api/admin/contestant-add': {
      const name = String(body.name || '').trim();
      if (!name) return json(res, 400, { error: '请填写选手姓名' });
      const now = Date.now();
      state.contestants.push({
        id: 'c' + (state.nextId++),
        name,
        className: String(body.className || '').trim(),
        song: String(body.song || '').trim(),
        photo: typeof body.photo === 'string' && body.photo.startsWith('data:') ? body.photo : null,
        votes: 0,
        updatedAt: now
      });
      structureDirty = true; dirty = true; save();
      return json(res, 200, { ok: true });
    }

    case '/api/admin/contestant-update': {
      const c = state.contestants.find(x => x.id === body.id);
      if (!c) return json(res, 404, { error: '选手不存在' });
      if (body.name != null) c.name = String(body.name).trim() || c.name;
      if (body.className != null) c.className = String(body.className).trim();
      if (body.song != null) c.song = String(body.song).trim();
      if ('photo' in body) c.photo = (typeof body.photo === 'string' && body.photo.startsWith('data:')) ? body.photo : (body.photo === null ? null : c.photo);
      c.updatedAt = Date.now();
      structureDirty = true; dirty = true; save();
      return json(res, 200, { ok: true });
    }

    case '/api/admin/contestant-delete': {
      const i = state.contestants.findIndex(x => x.id === body.id);
      if (i < 0) return json(res, 404, { error: '选手不存在' });
      state.contestants.splice(i, 1);
      structureDirty = true; dirty = true; save();
      return json(res, 200, { ok: true });
    }

    case '/api/admin/settings': {
      if (body.title != null && String(body.title).trim()) s.title = String(body.title).trim().slice(0, 40);
      if (body.votesPerDevice != null) {
        const n = Number(body.votesPerDevice);
        if (Number.isInteger(n) && n >= 1 && n <= 99) s.votesPerDevice = n;
      }
      if (typeof body.allowRepeat === 'boolean') s.allowRepeat = body.allowRepeat;
      if (body.publicUrl !== undefined) {
        const u = String(body.publicUrl || '').trim();
        if (u === '') s.publicUrl = '';
        else if (/^https?:\/\/.+/i.test(u)) s.publicUrl = u.replace(/\/+$/, '');
        else return json(res, 400, { error: '外网地址需以 http:// 或 https:// 开头' });
      }
      structureDirty = true; dirty = true; save();
      return json(res, 200, { ok: true });
    }

    case '/api/admin/password': {
      if (body.old !== s.adminPassword) return json(res, 403, { error: '原密码不正确' });
      const next = String(body.next || '');
      if (next.length < 4) return json(res, 400, { error: '新密码至少 4 位' });
      s.adminPassword = next;
      refreshAdminToken();
      save();
      return json(res, 200, { ok: true, token: adminToken });
    }

    case '/api/admin/status': {
      if (!['ready', 'open', 'ended'].includes(body.status)) return json(res, 400, { error: '状态不合法' });
      s.status = body.status;
      dirty = true; save();
      return json(res, 200, { ok: true, status: s.status });
    }

    case '/api/admin/reset': {
      setSimulate(false);
      for (const c of state.contestants) c.votes = 0;
      state.devices = {};
      state.latest = [];
      state.voteLog = [];
      try { fs.writeFileSync(VOTELOG_FILE, ''); } catch (_) {}
      structureDirty = true; dirty = true; save();
      return json(res, 200, { ok: true });
    }

    case '/api/admin/simulate':
      return json(res, 200, { ok: true, ...setSimulate(!!body.on, body.speed) });

    default:
      return json(res, 404, { error: '接口不存在' });
  }
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');
    const pathname = url.pathname;

    if (pathname === '/favicon.ico') { res.writeHead(204); return res.end(); }

    if (pathname === '/api/events') return handleSSE(req, res);

    if (pathname === '/api/state') {
      const snap = snapshot();
      const devId = url.searchParams.get('device') || '';
      const dev = state.devices[devId];
      snap.device = {
        used: dev ? dev.used : 0,
        remaining: dev ? Math.max(0, state.settings.votesPerDevice - dev.used) : state.settings.votesPerDevice,
        votedIds: dev ? Object.keys(dev.targets) : []
      };
      return json(res, 200, snap);
    }

    if (pathname === '/api/vote' && req.method === 'POST') {
      const body = await readBody(req);
      const ip = (req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim();
      const r = castVote(String(body.contestantId || ''), String(body.deviceId || ''), ip);
      return json(res, r.code, r.code === 200 ? { ok: true, ...r.data } : { error: r.error });
    }

    if (pathname.startsWith('/api/photo/')) {
      return handlePhoto(res, pathname.slice('/api/photo/'.length));
    }

    if (pathname.startsWith('/api/admin/')) {
      if (pathname === '/api/admin/export') {
        if (!isAdmin(req)) return json(res, 401, { error: '请先登录' });
        return exportCSV(res);
      }
      return await handleAdmin(req, res, pathname, url.searchParams);
    }

    if (req.method !== 'GET' && req.method !== 'HEAD') {
      return json(res, 405, { error: '方法不允许' });
    }
    serveStatic(req, res, pathname);
  } catch (e) {
    console.error('[服务器错误]', e);
    if (!res.headersSent) json(res, 500, { error: '服务器内部错误' });
  }
});

/* ============================== 启动 ============================== */

loadData();

process.on('SIGINT', () => { saveNow(); process.exit(0); });

server.listen(PORT, '0.0.0.0', () => {
  const ips = [];
  for (const list of Object.values(os.networkInterfaces())) {
    for (const it of list || []) {
      if (it.family === 'IPv4' && !it.internal && !ips.includes(it.address)) ips.push(it.address);
    }
  }
  const urls = ips.length ? ips : ['127.0.0.1'];
  console.log('');
  console.log('  ============================================');
  console.log('   校园十佳歌手 · 实时投票系统 已启动');
  console.log('  ============================================');
  console.log('   本机演示:');
  console.log('     管理后台   http://localhost:' + PORT + '/admin');
  console.log('     实时大屏   http://localhost:' + PORT + '/screen');
  console.log('');
  console.log('   学生投票（手机连同一 WiFi，逐个试哪个能打开）:');
  for (const ip of urls) console.log('     ' + 'http://' + ip + ':' + PORT + '/');
  console.log('');
  console.log('   管理密码: ' + state.settings.adminPassword + '（可在后台修改）');
  console.log('   关闭本窗口或按 Ctrl+C 即可停止系统');
  console.log('  ============================================');
  console.log('');
});
