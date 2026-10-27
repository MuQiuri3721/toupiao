'use strict';

function fail(status, message) { throw Object.assign(new Error(message), { status }); }

/**
 * 唯一购买权益记账入口。人工确认收款与未来可信网关回调应复用该事务。
 * 此处只生成购买记录，不调用或宣称已经开通独立投票系统。
 * 待支付 -> 已支付；取消为终态；已支付重放返回原订单，绝不再次加额度。
 * 金额和额度只读取下单快照，不能使用浏览器提交的值。
 */
function confirmPayment(store, id) {
  return store.transaction(() => {
    const { db } = store;
    const order = db.prepare('SELECT * FROM orders WHERE id=?').get(id);
    if (!order) fail(404, '订单不存在');
    if (order.status === 'cancelled') fail(409, '已取消的订单不能确认收款');
    if (order.status === 'paid') return order;
    const paidAt = new Date().toISOString();
    db.prepare("UPDATE orders SET status='paid', paidAt=? WHERE id=? AND status='pending'").run(paidAt, id);
    db.prepare('UPDATE users SET credits=credits+? WHERE id=?').run(order.quota, order.userId);
    // orderId 唯一约束是第二道幂等保护，任何一步失败会连同订单状态一起回滚。
    db.prepare('INSERT INTO ledger(userId,delta,reason,orderId,createdAt) VALUES (?,?,?,?,?)')
      .run(order.userId, order.quota, `购买${order.planName}`, id, paidAt);
    return db.prepare('SELECT * FROM orders WHERE id=?').get(id);
  });
}

function unconfiguredCallback() {
  // 预留边界：目前未接入微信/支付宝 SDK，禁止把任意 POST 当成付款成功。
  // 正式接入时先验平台签名、商户身份、交易状态、币种及订单金额；通过后
  // 保存平台交易号（唯一约束）并调用 confirmPayment，按平台协议回复回执。
  // 静态收款码没有网关签名回调，须由管理员实际核实到账。
  fail(501, '尚未接入支付网关，请由管理员核实到账后确认订单');
}
module.exports = { confirmPayment, unconfiguredCallback, fail };
