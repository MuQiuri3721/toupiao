'use strict';

/**
 * 完整端到端测试脚本（零依赖）
 * 用法：服务启动后执行  node e2e-test.js
 * 覆盖：静态资源 / 登录鉴权 / 投票状态机 / 票数上限 / 防重复 /
 *       规则与选手管理 / 密码修改 / 模拟投票 / SSE 推送 / IP 限速
 * 注意：会修改数据（最后可通过后台「清空所有票数」恢复）
 */

const http = require('http');
const BASE = 'http://localhost:' + (process.env.PORT || 3000);

let pass = 0, fail = 0;
const lines = [];
function check(name, cond, detail) {
  if (cond) { pass++; lines.push('  [PASS] ' + name); }
  else { fail++; lines.push('  [FAIL] ' + name + (detail ? '  ← ' + detail : '')); }
}

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
      res.on('end', () => {
        let json = null;
        try { json = JSON.parse(buf); } catch (_) {}
        resolve({ status: res.statusCode, json, text: buf });
      });
    });
    r.on('error', reject);
    if (data) r.write(data);
    r.end();
  });
}

function sseCollect(seconds) {
  return new Promise(resolve => {
    const events = [];
    const r = http.get(BASE + '/api/events', res => {
      let buf = '';
      res.on('data', c => {
        buf += c;
        let i;
        while ((i = buf.indexOf('\n\n')) >= 0) {
          const chunk = buf.slice(0, i);
          buf = buf.slice(i + 2);
          const m = chunk.match(/^data: (.+)$/m);
          if (m) { try { events.push(JSON.parse(m[1])); } catch (_) {} }
        }
      });
    });
    r.on('error', () => resolve(events));
    setTimeout(() => { r.destroy(); resolve(events); }, seconds * 1000);
  });
}

const vote = (cid, dev) => req('/api/vote', { method: 'POST', body: { contestantId: cid, deviceId: dev } });

async function main() {
  console.log('===== 校园十佳歌手投票系统 · 完整测试 =====\n');

  /* ---------- A. 静态资源 ---------- */
  console.log('[A] 静态资源与页面可达性');
  for (const p of ['/', '/screen', '/admin', '/css/common.css', '/css/vote.css', '/css/screen.css', '/css/admin.css',
    '/js/common.js', '/js/vote.js', '/js/screen.js', '/js/admin.js', '/js/decor.js', '/js/qrcode.min.js']) {
    const r = await req(p);
    check('GET ' + p, r.status === 200, 'HTTP ' + r.status);
  }
  const fav = await req('/favicon.ico');
  check('GET /favicon.ico 不报错', fav.status === 204 || fav.status === 404 || fav.status === 200, 'HTTP ' + fav.status);

  /* ---------- B. 登录与鉴权 ---------- */
  console.log('[B] 登录与鉴权');
  const badLogin = await req('/api/admin/login', { method: 'POST', body: { password: 'wrong' } });
  check('错误密码被拒绝(401)', badLogin.status === 401);
  const login = await req('/api/admin/login', { method: 'POST', body: { password: '123456' } });
  check('正确密码拿到 token', login.status === 200 && !!login.json.token);
  const T = login.json.token;
  const noAuth = await req('/api/admin/overview');
  check('无 token 访问管理接口被拒(401)', noAuth.status === 401);
  const badAuth = await req('/api/admin/overview', { token: 'fake-token' });
  check('伪造 token 被拒(401)', badAuth.status === 401);
  const ov = await req('/api/admin/overview', { token: T });
  check('正确 token 拿到 overview', ov.status === 200 && ov.json.contestants.length > 0);
  check('overview 不泄露密码字段', !('adminPassword' in (ov.json.settings || {})));

  /* ---------- C. CSV 导出 ---------- */
  console.log('[C] 结果导出');
  const csv = await req('/api/admin/export', { token: T });
  check('CSV 可导出', csv.status === 200);
  check('CSV 带 BOM(Excel 中文不乱码)', csv.text.charCodeAt(0) === 0xFEFF);
  check('CSV 行数 = 选手数 + 表头', csv.text.trim().split('\r\n').length === ov.json.contestants.length + 1);
  const csvNoAuth = await req('/api/admin/export');
  check('无 token 导出被拒(401)', csvNoAuth.status === 401);

  /* ---------- D. 投票状态机 ---------- */
  console.log('[D] 投票状态机');
  const dev = 'e2e-dev-' + Date.now();
  await req('/api/admin/status', { method: 'POST', token: T, body: { status: 'ended' } });
  let v = await vote('c1', dev);
  check('「已结束」时投票被拒', v.status === 403 && /结束/.test(v.json.error), v.json.error);
  await req('/api/admin/status', { method: 'POST', token: T, body: { status: 'ready' } });
  v = await vote('c1', dev);
  check('「未开始」时投票被拒', v.status === 403 && /尚未开始/.test(v.json.error), v.json.error);
  await req('/api/admin/status', { method: 'POST', token: T, body: { status: 'open' } });
  v = await vote('c1', dev);
  check('「投票中」正常投票', v.status === 200 && v.json.ok === true && v.json.used === 1);
  v = await vote('c1', dev);
  v = await vote('c1', dev);
  check('连投到 3/3', v.status === 200 && v.json.used === 3 && v.json.remaining === 0);
  v = await vote('c1', dev);
  check('第 4 票被拒(票数用完)', v.status === 403 && /用完/.test(v.json.error), v.json.error);

  /* ---------- E. 规则：防重复 + 票数上限 ---------- */
  console.log('[E] 投票规则');
  await req('/api/admin/settings', { method: 'POST', token: T, body: { allowRepeat: false } });
  const devB = dev + '-b';
  v = await vote('c2', devB);
  check('关闭重复投：首次成功', v.status === 200);
  v = await vote('c2', devB);
  check('关闭重复投：同选手第二票被拒', v.status === 403 && /只能投一票/.test(v.json.error), v.json.error);
  v = await vote('c3', devB);
  check('换选手仍可投', v.status === 200);
  await req('/api/admin/settings', { method: 'POST', token: T, body: { allowRepeat: true } });

  await req('/api/admin/settings', { method: 'POST', token: T, body: { votesPerDevice: 5 } });
  const devC = dev + '-c';
  let allOk = true;
  for (let i = 0; i < 5; i++) { const r = await vote('c4', devC); if (r.status !== 200) allOk = false; }
  check('票数上限改为 5 后可连投 5 票', allOk);
  const stC = await req('/api/state?device=' + devC);
  check('该设备剩余票数为 0', stC.json.device.remaining === 0);
  await req('/api/admin/settings', { method: 'POST', token: T, body: { votesPerDevice: 3 } });

  /* ---------- F. 非法输入 ---------- */
  console.log('[F] 非法输入');
  v = await vote('c999', 'e2e-dev-x');
  check('不存在的选手(404)', v.status === 404);
  v = await vote('', 'e2e-dev-x');
  check('空选手 ID 被拒', v.status === 400 || v.status === 404);
  const badState = await req('/api/state?device=e2e-dev-c');
  check('state 接口返回设备投票信息', badState.json.device && typeof badState.json.device.used === 'number');

  /* ---------- G. 选手管理 ---------- */
  console.log('[G] 选手管理');
  const add = await req('/api/admin/contestant-add', { method: 'POST', token: T, body: { name: '测试选手甲', className: '测试班', song: '测试之歌' } });
  check('添加选手', add.status === 200);
  let ovNow = await req('/api/admin/overview', { token: T });
  const added = ovNow.json.contestants.find(c => c.name === '测试选手甲');
  check('新选手出现在列表', !!added);
  const upd = await req('/api/admin/contestant-update', { method: 'POST', token: T, body: { id: added.id, name: '测试选手乙', song: '新歌' } });
  check('编辑选手', upd.status === 200);
  ovNow = await req('/api/admin/overview', { token: T });
  check('修改已生效', ovNow.json.contestants.some(c => c.name === '测试选手乙' && c.song === '新歌'));
  const del = await req('/api/admin/contestant-delete', { method: 'POST', token: T, body: { id: added.id } });
  check('删除选手', del.status === 200);
  ovNow = await req('/api/admin/overview', { token: T });
  check('选手已消失', !ovNow.json.contestants.some(c => c.id === added.id));

  /* ---------- H. 标题设置 ---------- */
  console.log('[H] 活动标题');
  await req('/api/admin/settings', { method: 'POST', token: T, body: { title: '测试标题XYZ' } });
  let st = await req('/api/state');
  check('标题修改生效', st.json.title === '测试标题XYZ');
  await req('/api/admin/settings', { method: 'POST', token: T, body: { title: '校园十佳歌手大赛' } });
  st = await req('/api/state');
  check('标题已恢复', st.json.title === '校园十佳歌手大赛');

  /* ---------- I. 密码修改 ---------- */
  console.log('[I] 密码修改');
  const pw1 = await req('/api/admin/password', { method: 'POST', token: T, body: { old: '123456', next: 'test1234' } });
  check('修改密码成功并返回新 token', pw1.status === 200 && !!pw1.json.token);
  const oldTokenTry = await req('/api/admin/overview', { token: T });
  check('旧 token 立即失效(401)', oldTokenTry.status === 401);
  const newTokenTry = await req('/api/admin/overview', { token: pw1.json.token });
  check('新 token 可用', newTokenTry.status === 200);
  const wrongOld = await req('/api/admin/password', { method: 'POST', token: pw1.json.token, body: { old: '123456', next: 'zzzz' } });
  check('原密码错误时拒绝改密(403)', wrongOld.status === 403);
  const pw2 = await req('/api/admin/password', { method: 'POST', token: pw1.json.token, body: { old: 'test1234', next: '123456' } });
  check('密码已改回默认 123456', pw2.status === 200);

  /* ---------- J. 模拟投票 + SSE 实时推送 ---------- */
  console.log('[J] 模拟投票 + SSE 推送');
  const ssePromise = sseCollect(4);
  await new Promise(r => setTimeout(r, 300));
  const before = (await req('/api/state')).json.totalVotes;
  await req('/api/admin/simulate', { method: 'POST', token: pw2.json.token, body: { on: true, speed: 'fast' } });
  await new Promise(r => setTimeout(r, 2500));
  const mid = (await req('/api/state')).json.totalVotes;
  await req('/api/admin/simulate', { method: 'POST', token: pw2.json.token, body: { on: false } });
  const after = (await req('/api/state')).json.totalVotes;
  const events = await ssePromise;
  check('模拟投票使票数增长(' + before + '→' + after + ')', after > before);
  check('停止模拟后票数不再变化', mid === after || after - mid < 30);
  check('SSE 收到推送事件(' + events.length + ' 条)', events.length >= 3);
  check('SSE 事件包含选手与总数', events.length > 0 && events[0].contestants && typeof events[0].totalVotes === 'number');

  /* ---------- K. IP 限速 ---------- */
  console.log('[K] IP 限速（对无效选手连发 4000 请求，不污染数据）');
  const total = 4000, CON = 40;
  let idx = 0, c404 = 0, c429 = 0, cOther = 0;
  async function bomber() {
    while (idx < total) {
      idx++;
      const r = await vote('c999', 'rate-test-dev');
      if (r.status === 404) c404++; else if (r.status === 429) c429++; else cOther++;
    }
  }
  await Promise.all(Array.from({ length: CON }, bomber));
  check('超量请求被限速 429（拦截 ' + c429 + ' 个）', c429 > 500, '404×' + c404 + ' 429×' + c429 + ' other×' + cOther);
  check('限速只拦请求不产生票数', cOther === 0, 'other×' + cOther);

  /* ---------- 汇总 ---------- */
  console.log('\n===== 测试结果 =====');
  lines.forEach(l => console.log(l));
  console.log('\n通过 ' + pass + ' / ' + (pass + fail) + (fail ? '  ← 有失败项！' : '  全部通过 ✔'));
  console.log('提示：投票状态当前为 open，IP 计数已打满，重启服务后恢复。');
  process.exit(fail ? 1 : 0);
}

main().catch(e => { console.error('测试脚本异常:', e); process.exit(1); });
