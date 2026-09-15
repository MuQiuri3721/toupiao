'use strict';

/**
 * 测试数据填充脚本（零依赖）
 * 用法：先启动系统（node server.js 或双击 bat），然后执行  node test-data.js
 *
 * 效果：模拟约 600 名观众通过真实投票接口投出约 1500 票，
 *       票数分布有明显的热门/冷门梯度，并自动开启投票状态。
 * 清除：在管理后台点「清空所有票数（开启新一轮）」即可。
 */

const http = require('http');

const BASE = 'http://localhost:' + (process.env.PORT || 3000);
const PASSWORD = '123456';   // 管理密码，若已在后台修改请同步改这里

// 各选手的目标票数权重（按选手添加顺序对应，可自行修改）
const WEIGHTS = [187, 172, 158, 143, 131, 118, 104, 97, 86, 74, 61, 48];

function req(path, { method = 'GET', body, token } = {}) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const r = http.request(BASE + path, {
      method,
      headers: Object.assign(
        { 'Content-Type': 'application/json' },
        data ? { 'Content-Length': Buffer.byteLength(data) } : {},
        token ? { 'x-admin-token': token } : {}
      ),
    }, res => {
      let buf = '';
      res.on('data', c => buf += c);
      res.on('end', () => { try { resolve(JSON.parse(buf)); } catch (_) { resolve(buf); } });
    });
    r.on('error', reject);
    if (data) r.write(data);
    r.end();
  });
}

function pickContestant() {
  const total = WEIGHTS.reduce((s, w) => s + w, 0);
  let r = Math.random() * total;
  for (let i = 0; i < WEIGHTS.length; i++) {
    r -= WEIGHTS[i];
    if (r < 0) return 'c' + (i + 1);
  }
  return 'c' + WEIGHTS.length;
}

async function main() {
  console.log('1) 管理员登录…');
  const login = await req('/api/admin/login', { method: 'POST', body: { password: PASSWORD } });
  if (!login.token) { console.error('   登录失败：' + (login.error || '密码错误')); process.exit(1); }
  const token = login.token;

  console.log('2) 开启投票…');
  await req('/api/admin/status', { method: 'POST', token, body: { status: 'open' } });

  console.log('3) 生成观众设备并模拟投票…');
  const totalVotes = WEIGHTS.reduce((s, w) => s + w, 0);
  const devices = [];
  let remaining = totalVotes;
  while (remaining > 0) {
    const used = Math.min(remaining, 1 + Math.floor(Math.random() * 3));   // 每人 1-3 票
    devices.push({
      id: 'test-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8),
      picks: Array.from({ length: used }, pickContestant)
    });
    remaining -= used;
  }
  console.log('   观众设备:', devices.length, '台，总票数:', totalVotes);

  const tasks = devices.flatMap(d => d.picks.map(cid => ({ device: d.id, cid })));
  const CONCURRENCY = 40;
  let idx = 0, finished = 0, fail = 0;
  async function worker() {
    while (idx < tasks.length) {
      const t = tasks[idx++];
      try {
        const r = await req('/api/vote', {
          method: 'POST',
          body: { deviceId: t.device, contestantId: t.cid }
        });
        if (!r.ok) fail++;
      } catch (_) { fail++; }
      finished++;
      if (finished % 300 === 0) console.log('   进度:', finished, '/', tasks.length);
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  if (fail) console.log('   失败票数:', fail, '(被限速拒绝，可忽略)');

  const state = await req('/api/state');
  console.log('4) 完成！当前总票数:', state.totalVotes, '| 参与设备:', state.deviceCount, '| 状态:', state.status);
  console.log('   实时排名前 5:');
  state.contestants.slice(0, 5).forEach((c, i) => {
    console.log('    #' + (i + 1), c.name, '(' + c.className + ')', c.votes, '票');
  });
  console.log('\n打开查看效果:');
  console.log('  实时大屏 ' + BASE + '/screen');
  console.log('  投票页   ' + BASE + '/');
  console.log('\n正式使用前，在管理后台点「清空所有票数（开启新一轮）」即可清除全部测试数据。');
}

main().catch(e => { console.error('执行失败:', e.message); process.exit(1); });
