#!/bin/bash
# ============================================================
# 校园十佳歌手投票系统 · 云服务器一键部署脚本
#
# 用法（在云服务器上，root 权限）：
#   1. 把整个项目文件夹上传到服务器，例如 /root/toupiao
#   2. 执行：cd /root/toupiao && bash server-setup.sh
#
# 适用于 Ubuntu / Debian（自带 apt）。
# 重复执行安全：升级代码不会丢票数（数据在 /opt/vote/data）。
# ============================================================
set -e

APP_DIR=/opt/vote
PORT=3000

echo "==> 1/5 检查并安装 Node.js（已装则跳过）"
if ! command -v node >/dev/null 2>&1; then
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
  apt-get install -y nodejs
fi
echo "   Node 版本: $(node -v)"

echo "==> 2/5 复制项目到 $APP_DIR（数据目录保留，升级不丢票）"
mkdir -p "$APP_DIR/data"
cp -r server.js public "$APP_DIR/"

echo "==> 3/5 写入 systemd 开机自启服务"
cat > /etc/systemd/system/vote.service << 'UNIT'
[Unit]
Description=Campus Singer Voting System
After=network-online.target
Wants=network-online.target

[Service]
WorkingDirectory=/opt/vote
ExecStart=/usr/bin/node /opt/vote/server.js
Restart=always
RestartSec=3
Environment=NODE_ENV=production

[Install]
WantedBy=multi-user.target
UNIT
systemctl daemon-reload

echo "==> 4/5 启用云模式（自动识别公网 IP 用于二维码）"
echo '{"mode":"cloud"}' > "$APP_DIR/config.json"

echo "==> 5/5 启动服务"
systemctl enable vote >/dev/null 2>&1
systemctl restart vote
sleep 2
systemctl --no-pager --lines=0 status vote || true

PUBLIC_IP=$(curl -s --max-time 8 https://ip.3322.net | tr -d '\r\n')
echo ""
echo "=========================================================="
echo "  部署完成！"
echo "  投票页   : http://$PUBLIC_IP:$PORT/"
echo "  实时大屏 : http://$PUBLIC_IP:$PORT/screen"
echo "  管理后台 : http://$PUBLIC_IP:$PORT/admin"
echo ""
echo "  两个必做事项："
echo "  1. 云控制台「防火墙/安全组」放行 TCP $PORT 端口"
echo "  2. 登录管理后台修改默认密码 123456"
echo "=========================================================="
