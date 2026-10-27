'use strict';
const {test} = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {createPlatform} = require('../platform/api');

test('单页销售：访客下单、订单隔离与确认收款', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(),'qingtou-commerce-'));
  const dbPath = path.join(dir,'test.sqlite');
  let platform = createPlatform({dbPath,adminPassword:'qa-admin-password'});
  const server = http.createServer(async(req,res)=>{
    if (!await platform.handle(req,res,new URL(req.url,'http://localhost'))) {res.writeHead(404);res.end();}
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  t.after(async()=>{await new Promise(resolve=>server.close(resolve));platform.close();fs.rmSync(dir,{recursive:true,force:true});});
  const base = `http://127.0.0.1:${server.address().port}`;
  function client() {
    const jar = new Map();
    return async(route,method='GET',body,headers={})=>{
      const r=await fetch(base+route,{method,headers:{'Content-Type':'application/json',Cookie:[...jar].map(([k,v])=>`${k}=${v}`).join('; '),...headers},body:body===undefined?undefined:JSON.stringify(body)});
      r.headers.getSetCookie().forEach(c=>{const[k,v]=c.split(';')[0].split('=');jar.set(k,v);});
      const raw=await r.text();let data;try{data=JSON.parse(raw);}catch{data=raw;}
      return {status:r.status,data,headers:r.headers};
    };
  }
  const buyer=client(),other=client(),admin=client();
  const api = '/api/platform';
  const contact={planId:'basic',contact:'张三',phone:'13800138000',invoiceTitle:'测试企业',taxId:'TEST123',method:'wechat'};
  let order;
  await t.test('首页可访问，展示性官网不提供投票和工作台',async()=>{
    const r=await buyer('/');assert.equal(r.status,200);assert.ok(r.data.includes('commerce-dialog'));
    for(const route of ['/console','/poll/example',api+'/polls']) assert.equal((await buyer(route)).status,404);
  });
  await t.test('无需注册直接下单，服务端价格与套餐快照',async()=>{
    const r=await buyer(api+'/checkout','POST',{...contact,price:1,quota:1000000});
    assert.equal(r.status,201);order=r.data.order;
    assert.equal(order.price,9900);assert.equal(order.quota,1000);assert.equal(order.status,'pending');
    assert.equal(order.contact,'张三');assert.equal(r.data.payment.mode,'manual');assert.equal(r.data.payment.wechat,null);
    assert.ok(r.headers.get('set-cookie').includes('HttpOnly'));
    assert.equal((await buyer(api+'/orders')).data.orders.length,1);
  });
  await t.test('订单归属隔离，不泄露他人联系信息',async()=>{
    assert.equal((await other(api+'/orders')).status,401);
    await other(api+'/checkout','POST',{...contact,contact:'另一访客'});
    assert.equal((await other(api+'/orders/'+order.id)).status,404);
    assert.equal((await other(api+'/orders/'+order.id+'/cancel','POST',{})).status,404);
    assert.equal((await other(api+'/orders/'+order.id+'/report','POST',{})).status,404);
  });
  await t.test('客户付款申请不是到账，无权确认订单，网关空接口拒绝',async()=>{
    const r=await buyer(api+`/orders/${order.id}/report`,'POST',{method:'alipay'});
    assert.equal(r.data.order.status,'pending');assert.ok(r.data.order.reportedAt);assert.equal(r.data.order.method,'alipay');
    assert.equal((await buyer(api+`/admin/orders/${order.id}/confirm`,'POST',{})).status,401);
    assert.equal((await buyer(api+'/payments/callback/wechat','POST',{status:'paid',id:order.id})).status,501);
    assert.equal((await buyer(api+'/orders/'+order.id)).data.order.status,'pending');
  });
  await t.test('确认收款与权益入账事务、重放幂等、取消终态',async()=>{
    assert.equal((await admin(api+'/admin/login','POST',{password:'bad'})).status,401);
    assert.equal((await admin(api+'/admin/login','POST',{password:'qa-admin-password'})).status,200);
    const rs=await Promise.all(Array.from({length:4},()=>admin(api+`/admin/orders/${order.id}/confirm`,'POST',{})));
    assert.ok(rs.every(x=>x.status===200&&x.data.order.status==='paid'));
    const info=(await admin(api+'/admin/overview')).data;
    const entitlement=info.users.find(x=>x.id===order.userId);assert.equal(entitlement.credits,1000);
    assert.equal((await buyer(api+`/orders/${order.id}/cancel`,'POST',{})).status,409);
    const next=(await buyer(api+'/checkout','POST',contact)).data.order;
    assert.equal((await buyer(api+`/orders/${next.id}/cancel`,'POST',{})).data.order.status,'cancelled');
    assert.equal((await admin(api+`/admin/orders/${next.id}/confirm`,'POST',{})).status,409);
    assert.equal((await buyer(api+'/orders')).data.orders.length,2);
  });
  await t.test('套餐编辑、上架下架及历史订单金额不变',async()=>{
    const p=(await admin(api+'/admin/overview')).data.plans.find(x=>x.id==='basic');
    assert.equal((await admin(api+'/admin/plans','POST',{...p,price:19900,quota:1500})).status,200);
    assert.equal((await buyer(api+'/orders/'+order.id)).data.order.price,9900);
    assert.equal((await admin(api+'/admin/plans','POST',{...p,price:0})).status,400);
    await admin(api+'/admin/plans','POST',{...p,active:false});
    assert.equal((await buyer(api+'/checkout','POST',contact)).status,400);
  });
  await t.test('输入与跨站校验，UTF-8中文跨网络分块不损坏',async()=>{
    assert.equal((await buyer(api+'/checkout','POST',{...contact,planId:'pro'}, {Origin:'https://evil.test'})).status,403);
    assert.equal((await buyer(api+'/checkout','POST',{...contact,planId:'pro',phone:''})).status,400);
    const bytes=Buffer.from(JSON.stringify({...contact,planId:'pro'}));const cut=bytes.indexOf(Buffer.from('张'))+1;
    const r=await new Promise((resolve,reject)=>{
      const req=http.request(base+api+'/checkout',{method:'POST',headers:{'Content-Type':'application/json'}},res=>{
        let raw='';res.setEncoding('utf8');res.on('data',x=>raw+=x);res.on('end',()=>resolve({status:res.statusCode,data:JSON.parse(raw)}));
      });req.on('error',reject);req.write(bytes.subarray(0,cut));setTimeout(()=>req.end(bytes.subarray(cut)),30);
    });assert.equal(r.status,201);assert.equal(r.data.order.contact,'张三');
  });
  await t.test('重启后保留订单与订单持有会话',async()=>{
    platform.close();platform=createPlatform({dbPath,adminPassword:'qa-admin-password'});
    assert.equal((await buyer(api+'/orders/'+order.id)).data.order.status,'paid');
    const records=(await admin(api+'/admin/overview')).data.users;
    assert.equal(records.find(x=>x.id===order.userId).credits,1000);
  });
});
