# 轻投 · 投票产品销售页

本项目的新官网仅提供一个销售页面：产品介绍、套餐选择、直接购买、订单支付和人工核实到账。文案介绍的投票产品另行实现，本期不提供实际创建活动、参与投票、工作台、用户中心或投票消耗功能。原校园十佳歌手模块独立保留。

## 快速启动

安装 **Node.js 24 或更高版本**，无需 `npm install`。在项目目录的 PowerShell 中执行：

```powershell
$env:PLATFORM_ADMIN_PASSWORD = '替换为你自己的复杂密码'
npm start
# 也可运行 node server.js，或双击 启动平台.bat
```

默认访问 http://localhost:3000/ 。可在启动前设置 `$env:PORT = '8080'`。未设置 `PLATFORM_ADMIN_PASSWORD` 时，管理员不能登录订单管理。双击脚本不会继承另一个 PowerShell 窗口临时设置的变量；需要密码时建议在设置变量的同一终端启动。

## 页面与入口

| 页面或入口 | 默认地址 | 用途 |
| --- | --- | --- |
| 销售首页 | http://localhost:3000/ | 产品介绍、套餐与直接购买 |
| 购买、订单支付 | 首页弹窗 | 访客填写联系信息，查看收款码、申请核实 |
| 我的订单 | 首页弹窗 | 仅查看当前浏览器持有 Cookie 对应的订单 |
| 订单管理 | 首页弹窗 | 管理员登录后核实与确认到账 |
| 原校园学生页 | http://localhost:3000/legacy | 独立旧模块 |
| 原校园后台 | http://localhost:3000/admin | 独立旧模块管理 |
| 原校园大屏 | http://localhost:3000/screen | 独立旧模块实时排名 |

新官网没有独立的 `/features`、`/pricing`、`/checkout`、`/payment`、`/account`、`/console`、`/poll` 页面。购买无需注册登录；内部账户原语仅用于订单归属，不提供注册或登录界面。校园模块不是销售官网的入口。

## 购买流程与订单规则

1. 在首页了解产品并选择套餐，打开购买弹窗填写联系信息、付款方式与可选开票需求。
2. 提交后通过 `POST /api/platform/checkout` 创建订单，并设置持有订单的浏览器 Cookie。
3. 查看平台配置的真实收款码，按订单金额付款，再点“我已付款，申请核实”。这只是申请，不代表到账。
4. 管理员在收款账户实际核实到账后，打开首页“订单管理”确认订单，系统记录套餐权益入账。
5. 用户在同一浏览器打开“我的订单”查看状态。请勿清除 Cookie；更换浏览器或设备不能自动恢复订单，需要通过订单联系信息与管理员联系处理。

价格 `price` 使用整数“分”；服务端根据套餐生成订单，保存套餐名称、价格及权益额度快照，后续套餐调整不改变历史订单。确认到账通过事务同时更新订单、权益余额和流水；重复确认已支付订单不会重复入账。取消订单为终态，不能再确认到账。

本期只记录购买的套餐权益，不执行投票、不扣减投票额度，也没有新平台的 polls/votes 数据表。权益记录不代表完整投票产品已经交付或开通。

## 支付与能力边界

当前仅支持二维码展示和人工核实。将自有收款码分别放到 `public/platform/payment/wechat.png`、`public/platform/payment/alipay.png`（按需创建目录）；文件不存在时显示“待配置”。没有自动对账，预留支付回调返回 HTTP 501。发票字段仅记录需求，不自动开票。详见 [支付接入说明](docs/支付接入说明.md)。

当前不支持账户恢复、忘记密码、邮箱验证、跨设备订单恢复或真实支付网关。投票产品的实时统计、防刷、活动执行等不属于新销售页本期实现。HTTPS 部署时可设置 `COOKIE_SECURE=1`；本机 HTTP 调试不要设置，否则登录及订单 Cookie 可能无法正常发送。

## 数据、备份与测试

新销售页数据为 `data/platform.sqlite`，原校园数据为 `data/data.json`，两者分开保存。备份 SQLite 前请正常停服，确认连接关闭后复制；不要在运行期间只复制主库而漏掉 `platform.sqlite-wal` 等伴随文件。恢复前也应停服并备份当前数据。

```powershell
npm test
```

`npm test` 运行 `tests/commerce.test.js`。旧 `e2e-test.js`、`test-data.js`、`restore-roster.js` 会修改校园模块数据，不要对真实活动直接运行。隔离测试时，在单独终端将 `PLATFORM_DB` 设置为独立 SQLite 文件、`LEGACY_DATA_DIR` 设置为独立旧数据目录，并使用独立端口启动；测试脚本目标地址须与隔离服务一致。不要默认修改或指向生产数据。

## 文件结构

以下为项目代码与说明文件；`data/` 为运行时数据目录，二维码目录按需创建。

```text
投票/
├── server.js
├── package.json
├── README.md
├── 使用说明.md
├── 启动平台.bat
├── 启动投票系统.bat
├── server-setup.sh
├── e2e-test.js
├── test-data.js
├── restore-roster.js
├── r1-e2e.txt
├── e2e-final.txt
├── tests/
│   └── commerce.test.js
├── platform/
│   ├── store.js
│   ├── api.js
│   └── payments.js
├── docs/
│   ├── 付费投票平台实施方案.md
│   ├── 支付接入说明.md
│   ├── 验收记录.md
│   ├── screenshots/
│   │   ├── home-desktop.png
│   │   └── mobile-checkout.png
│   └── superpowers/plans/2026-10-27-platform.md
└── public/
    ├── vote.html
    ├── admin.html
    ├── screen.html
    ├── css/
    │   ├── common.css
    │   ├── vote.css
    │   ├── admin.css
    │   └── screen.css
    ├── js/
    │   ├── common.js
    │   ├── vote.js
    │   ├── admin.js
    │   ├── screen.js
    │   ├── decor.js
    │   └── qrcode.min.js
    └── platform/
        ├── index.html
        ├── app.js
        ├── style.css
        └── vendor/
            ├── PROVENANCE.md
            └── THREEUI-LICENSE
```

ThreeUI 仅改编 Gradient CTA / Gradient Pill Button 的 HTML/CSS 按钮样式，未安装 React 或 ThreeUI npm 包。见 [改编记录](public/platform/vendor/PROVENANCE.md) 与 [MIT 许可](public/platform/vendor/THREEUI-LICENSE)。

## 原校园十佳歌手模块

原学生页为 `/legacy`，管理后台 `/admin` 与大屏 `/screen` 保持不变。原模块默认管理密码 `123456` 请修改，与销售页管理员密码独立。

旧模块仍提供选手管理、照片上传、投票规则、SSE 实时排名、模拟投票与 CSV 导出；这些不属于新销售页。模拟票会写入旧数据，正式比赛前需清理演示票数。详见 [使用说明](使用说明.md) 的校园章节；旧部署脚本使用前须核查 Node.js 24 要求、端口与环境变量配置。
