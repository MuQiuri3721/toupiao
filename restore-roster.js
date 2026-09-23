'use strict';

/**
 * 恢复标准 12 人名单（清空票数、未开始状态）
 * 用法：在云服务器上执行  node restore-roster.js
 * （数据文件路径默认 /opt/vote/data/data.json，可通过 DATA_FILE 环境变量覆盖）
 */

const fs = require('fs');

const NAMES = [
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

const DATA_FILE = process.env.DATA_FILE || '/opt/vote/data/data.json';

let data = {};
try { data = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')); } catch (_) { console.log('（无既有数据文件，将全新创建）'); }

const now = Date.now();
data.nextId = NAMES.length + 1;
data.settings = Object.assign({}, data.settings, {
  title: '校园十佳歌手大赛',
  status: 'ready',
  votesPerDevice: 3,
  allowRepeat: true,
  voteDurationMin: 0
});
data.contestants = NAMES.map((c, i) => ({
  id: 'c' + (i + 1),
  name: c[0],
  className: c[1],
  song: c[2],
  photo: null,
  votes: 0,
  updatedAt: now
}));
data.devices = {};
data.latest = [];
data.voteDeadline = null;
data.voteLog = [];

fs.mkdirSync(require('path').dirname(DATA_FILE), { recursive: true });
fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 1));
console.log('已恢复标准 12 人名单，票数清零，状态=未开始');
console.log('重启服务后生效：systemctl restart vote');
