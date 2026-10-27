'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { openStore } = require('./store');
const { confirmPayment, unconfiguredCallback, fail } = require('./payments');
const now = () => new Date().toISOString();
const uid = prefix => prefix + crypto.randomBytes(12).toString('hex');
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
function text(value, label, max, required = true) {
  if (value === undefined || value === null) value = '';
  if (typeof value !== 'string') fail(400, `${label}格式不正确`);
  value = value.trim();
  if ((required && !value) || value.length > max) fail(400, `${label}不能为空且不能超过 ${max} 字`);
  return value;
}
function integer(value, min, max, label) {
  if (!Number.isSafeInteger(value) || value < min || value > max) fail(400, `${label}应为 ${min} 至 ${max} 的整数`);
  return value;
}
function cookies(req) {
  const result = {};
  for (const part of (req.headers.cookie || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) result[part.slice(0, i).trim()] = part.slice(i + 1).trim();
  }
  return result;
}
function equal(a, b) {
  const x = Buffer.from(a), y = Buffer.from(b);
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}
async function readJSON(req) {
  if (!(req.headers['content-type'] || '').toLowerCase().startsWith('application/json')) fail(415, '请使用 JSON 请求');
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 65536) fail(413, '请求内容过大');
    chunks.push(chunk);
  }
  try {
    // UTF-8 中文字符可能跨网络分块，拼接字节后才能统一解码。
    const data = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
    if (!data || Array.isArray(data) || typeof data !== 'object') fail(400, '请求应为 JSON 对象');
    return data;
  } catch (e) { if (e.status) throw e; fail(400, 'JSON 格式不正确'); }
}

function createPlatform(config = {}) {
  const publicDir = config.publicDir || path.join(__dirname, '../public/platform');
  const store = openStore(config.dbPath || path.join(__dirname, '../data/platform.sqlite'));
  const { db } = store;
  const adminPassword = config.adminPassword === undefined ? process.env.PLATFORM_ADMIN_PASSWORD : config.adminPassword;
  const secureCookies = process.env.COOKIE_SECURE === '1';
  const adminKey = adminPassword ? hash(adminPassword) : null;
  const rates = new Map();
  const mime = {'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.png':'image/png','.jpg':'image/jpeg','.svg':'image/svg+xml','.md':'text/plain; charset=utf-8','.txt':'text/plain; charset=utf-8'};
  function send(res, status, data) {
    res.writeHead(status, {'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});
    res.end(JSON.stringify(data));
  }
  function cookie(res, name, value, age = 604800) {
    const item = `${name}=${value}; Path=/; Max-Age=${age}; HttpOnly; SameSite=Lax${secureCookies ? '; Secure' : ''}`;
    const existing = res.getHeader('Set-Cookie') || [];
    res.setHeader('Set-Cookie', [...(Array.isArray(existing) ? existing : [existing]), item]);
  }
  function rate(key, limit, period) {
    const time = Date.now();
    // 每次访问顺便清理过期项，长期运行时不积累所有历史 IP。
    for (const [k, v] of rates) if (time > v.until) rates.delete(k);
    if (rates.size > 20000) fail(429, '访问繁忙，请稍后重试');
    const rec = rates.get(key) || { count: 0, until: time + period };
    rec.count++; rates.set(key, rec);
    if (rec.count > limit) fail(429, '操作过于频繁，请稍后重试');
  }
  function session(req, role) {
    const token = cookies(req)[role === 'admin' ? 'qt_admin' : 'qt_session'];
    if (!token || !/^[a-f0-9]{64}$/.test(token)) return null;
    return db.prepare('SELECT * FROM sessions WHERE tokenHash=? AND role=? AND expires>?').get(hash(token), role, Date.now()) || null;
  }
  function user(req, required = true) {
    const s = session(req, 'user');
    const u = s ? db.prepare('SELECT id,name,credits,createdAt FROM users WHERE id=?').get(s.userId) : null;
    if (!u && required) fail(401, '请先登录');
    return u || null;
  }
  function admin(req) { if (!session(req, 'admin')) fail(401, '请先登录平台管理后台'); }
  function startSession(req, res, userId, role) {
    const cookieName = role === 'admin' ? 'qt_admin' : 'qt_session';
    const previous = cookies(req)[cookieName];
    if (previous) db.prepare('DELETE FROM sessions WHERE tokenHash=?').run(hash(previous));
    db.prepare('DELETE FROM sessions WHERE expires<=?').run(Date.now());
    const token = crypto.randomBytes(32).toString('hex');
    db.prepare('INSERT INTO sessions VALUES (?,?,?,?)').run(hash(token), userId, role, Date.now() + (role === 'admin' ? 28800000 : 31536000000));
    cookie(res, cookieName, token, role === 'admin' ? 28800 : 31536000);
  }
  function ownerOrder(req, id) {
    const u = user(req);
    const row = db.prepare('SELECT * FROM orders WHERE id=? AND userId=?').get(id, u.id);
    if (!row) fail(404, '订单不存在');
    return row;
  }
  function paymentConfig() {
    const result = {mode:'manual',wechat:null,alipay:null};
    for (const provider of ['wechat','alipay']) {
      if (fs.existsSync(path.join(publicDir, 'payment', provider + '.png'))) {
        // 对外暴露路径可经 nginx 反代改写（如 PLATFORM_PUBLIC_BASE=/vote/shop），前端按 origin 解析需完整前缀
        result[provider] = (process.env.PLATFORM_PUBLIC_BASE || '') + '/platform/payment/' + provider + '.png';
      }
    }
    return result;
  }
  function file(req, res, filename) {
    if (!fs.existsSync(filename) || !fs.statSync(filename).isFile()) { res.writeHead(404); res.end('Not found'); return; }
    res.writeHead(200, {'Content-Type':mime[path.extname(filename)] || 'application/octet-stream','Cache-Control':'no-cache'});
    if (req.method === 'HEAD') return res.end();
    fs.createReadStream(filename).on('error', () => res.destroy()).pipe(res);
  }

  async function handle(req, res, url) {
    const pathname = url.pathname;
    const api = pathname === '/api/platform' || pathname.startsWith('/api/platform/');
    const page = pathname === '/';
    const asset = pathname.startsWith('/platform/');
    if (!api && !page && !asset) return false;
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'same-origin');
    res.setHeader('X-Frame-Options', 'SAMEORIGIN');
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'self'; form-action 'self'");
    try {
      if (!api) {
        if (!['GET','HEAD'].includes(req.method)) fail(405, '方法不允许');
        if (page) file(req, res, path.join(publicDir, 'index.html'));
        else {
          let relative; try { relative = decodeURIComponent(pathname.slice('/platform/'.length)); } catch { fail(400, '路径不正确'); }
          const filename = path.resolve(publicDir, relative);
          if (!filename.startsWith(path.resolve(publicDir) + path.sep)) fail(403, '路径不可访问');
          file(req, res, filename);
        }
        return true;
      }
      const route = pathname.slice('/api/platform'.length);
      const method = req.method;
      const ip = req.socket.remoteAddress || '';
      if (!['GET', 'HEAD'].includes(method)) {
        const origin = req.headers.origin;
        if (req.headers['sec-fetch-site'] === 'cross-site') fail(403, '不允许跨站提交');
        if (origin) {
          let host; try { host = new URL(origin).host; } catch { fail(403, '来源不正确'); }
          if (host !== req.headers.host) fail(403, '不允许跨站提交');
        }
      }
      if (route.startsWith('/payments/callback/') && method === 'POST') unconfiguredCallback();
      if (route === '/plans' && method === 'GET') return send(res, 200, {plans:db.prepare('SELECT * FROM plans WHERE active=1 ORDER BY price').all()}) || true;
      if (route === '/admin/logout' && method === 'POST') {
        const name = 'qt_admin';
        const token = cookies(req)[name];
        if (token) db.prepare('DELETE FROM sessions WHERE tokenHash=?').run(hash(token));
        cookie(res, name, '', 0); send(res, 200, {ok:true}); return true;
      }
      if (route === '/admin/login' && method === 'POST') {
        if (!adminKey) fail(503, '请先设置 PLATFORM_ADMIN_PASSWORD 环境变量后重启服务');
        rate('admin:' + ip, 10, 600000);
        const b = await readJSON(req);
        if (!equal(hash(text(b.password, '密码', 256)), adminKey)) fail(401, '管理密码不正确');
        startSession(req, res, null, 'admin'); send(res, 200, {ok:true}); return true;
      }
      if (route.startsWith('/admin/')) {
        admin(req);
        if (route === '/admin/overview' && method === 'GET') {
          send(res, 200, {
            plans:db.prepare('SELECT * FROM plans ORDER BY price').all(),
            orders:db.prepare('SELECT * FROM orders ORDER BY createdAt DESC LIMIT 500').all(),
            users:db.prepare('SELECT id,name,credits FROM users ORDER BY createdAt DESC LIMIT 500').all(),
            stats:{users:db.prepare('SELECT COUNT(*) n FROM users').get().n,orders:db.prepare('SELECT COUNT(*) n FROM orders').get().n,revenue:db.prepare("SELECT COALESCE(SUM(price),0) n FROM orders WHERE status='paid'").get().n},
            payment:paymentConfig()
          }); return true;
        }
        const confirm = route.match(/^\/admin\/orders\/([^/]+)\/confirm$/);
        if (confirm && method === 'POST') { send(res, 200, {order:confirmPayment(store, confirm[1])}); return true; }
        if (route === '/admin/plans' && method === 'POST') {
          const b = await readJSON(req);
          const id = b.id ? text(b.id, '套餐 ID', 60) : uid('plan_');
          const name = text(b.name, '套餐名称', 50), description = text(b.description, '套餐说明', 400, false);
          const price = integer(b.price, 1, 100000000, '价格（分）'), quota = integer(b.quota, 1, 100000000, '票数');
          if (b.active !== undefined && ![0,1,true,false].includes(b.active)) fail(400, '上架状态不正确');
          const active = b.active === undefined ? 1 : Number(b.active);
          db.prepare('INSERT INTO plans VALUES (?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,price=excluded.price,quota=excluded.quota,description=excluded.description,active=excluded.active').run(id,name,price,quota,description,active);
          send(res, 200, {plan:db.prepare('SELECT * FROM plans WHERE id=?').get(id)}); return true;
        }
        fail(404, '管理接口不存在');
      }
      if (route === '/checkout' && method === 'POST') {
        rate('checkout:' + ip, 30, 60000);
        const b = await readJSON(req);
        const plan = db.prepare('SELECT * FROM plans WHERE id=? AND active=1').get(text(b.planId, '套餐', 60));
        if (!plan) fail(400, '套餐不存在或已下架');
        const contact = text(b.contact, '联系人', 60), phone = text(b.phone, '联系方式', 100);
        if (phone.length < 5) fail(400, '请填写有效联系方式');
        const invoiceTitle = text(b.invoiceTitle, '发票抬头', 200, false), taxId = text(b.taxId, '税号', 80, false);
        const method = b.method || 'wechat';
        if (!['wechat','alipay'].includes(method)) fail(400, '请选择微信或支付宝');
        let u = user(req, false);
        const isNew = !u;
        const id = 'QT' + Date.now() + crypto.randomBytes(5).toString('hex').toUpperCase();
        // 访客下单不要求注册。随机会话用于隔离订单，不按手机号公开查询订单。
        // 联系信息校验通过后，访客身份与订单在同一事务写入，失败不留下空记录。
        store.transaction(() => {
          if (!u) {
            u = {id:uid('buyer_')};
            db.prepare('INSERT INTO users(id,name,createdAt) VALUES (?,?,?)').run(u.id, contact, now());
          }
          db.prepare("INSERT INTO orders(id,userId,planId,planName,price,quota,status,contact,phone,invoiceTitle,taxId,method,createdAt) VALUES (?,?,?,?,?,?,'pending',?,?,?,?,?,?)")
            .run(id,u.id,plan.id,plan.name,plan.price,plan.quota,contact,phone,invoiceTitle,taxId,method,now());
        });
        // 访客会话保留一年；浏览器清理 Cookie 后须联系管理员处理订单归属。
        if (isNew) startSession(req, res, u.id, 'user');
        send(res, 201, {order:db.prepare('SELECT * FROM orders WHERE id=?').get(id),payment:paymentConfig()}); return true;
      }
      if (route === '/orders' && method === 'GET') {
        const u = user(req);
        send(res, 200, {orders:db.prepare('SELECT * FROM orders WHERE userId=? ORDER BY createdAt DESC').all(u.id)}); return true;
      }
      const orderRoute = route.match(/^\/orders\/([^/]+)(?:\/(report|cancel))?$/);
      if (orderRoute) {
        const order = ownerOrder(req, orderRoute[1]);
        if (!orderRoute[2] && method === 'GET') { send(res, 200, {order,payment:paymentConfig()}); return true; }
        if (method === 'POST' && orderRoute[2]) {
          if (order.status !== 'pending') fail(409, '仅待支付订单可以执行此操作');
          if (orderRoute[2] === 'report') {
            const body = await readJSON(req);
            const method = body.method || order.method;
            if (!['wechat','alipay'].includes(method)) fail(400, '付款方式不正确');
            db.prepare('UPDATE orders SET reportedAt=?,method=? WHERE id=?').run(now(), method, order.id);
          }
          else db.prepare("UPDATE orders SET status='cancelled' WHERE id=? AND status='pending'").run(order.id);
          send(res, 200, {order:db.prepare('SELECT * FROM orders WHERE id=?').get(order.id)}); return true;
        }
      }
      fail(404, '接口不存在');
    } catch (e) {
      if (!e.status) console.error('[平台]', e);
      if (!res.headersSent) send(res, e.status || 500, {error:e.status ? e.message : '服务器内部错误，请稍后再试'});
      else res.destroy();
      return true;
    }
  }
  return { handle, close:store.close };
}
module.exports = { createPlatform };
