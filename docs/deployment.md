# SynthVerse 完整部署流程

日期：2026-10-09。本文依据当前仓库核对，提供本机运行和一台Ubuntu服务器的部署路径。以下服务器命令与配置是操作指南，尚未在远程服务器执行；本轮没有购买服务器、上传代码、配置域名或修改应用的来源白名单。

推荐拓扑：浏览器 → HTTPS Nginx → dist静态网页；同一域名的/api/ → 127.0.0.1:8787 Node网关 → 模型供应商。音频合成/渲染在浏览器，服务器负责Agent工具与模型请求。当前无需数据库、Redis、GPU或Vital编译环境。

## 1. 先在Windows本机验收

安装Node.js22.x（至少22.12），本项目此前以22.17验证。新部署可用22.x维护版，具体版本以[官方下载安装页](https://nodejs.org/en/download)为准。

```powershell
Set-Location D:\Repos\SynthVerse
node --version
npm.cmd --version
npm.cmd ci
Copy-Item .env.example .env
notepad .env
```

若.env已存在，保留原文件，跳过复制。先让MODEL_CHAT_URL和MODEL_NAME留空运行规则演示；配置真实模型时填写：

```dotenv
MODEL_CHAT_URL=https://你的供应商/完整/chat/completions/地址
MODEL_NAME=供应商账户实际可用的模型ID
MODEL_API_KEY=你的API密钥
MODEL_EXECUTION_MODE=agent
```

地址是完整请求URL，不是服务首页；供应商必须支持兼容的tools/tool_calls协议。agent是正常创作模式，direct是无工具的结构化生成对照。API Key只放后端，不使用VITE_前缀。现在配置的是文字/工具Agent，不会自动启用Gemini/Qwen的原始音频理解，后者仍需要新增音频适配工具。

```powershell
npm.cmd run dev
```

访问http://127.0.0.1:5173。Vite开发服务器把/api请求代理到本机8787；两个进程需同时运行。不要把开发服务直接暴露到公网。

另开终端完成上线前检查：

```powershell
npm.cmd run build
npm.cmd test
npm.cmd run eval
npx.cmd playwright install chromium
npm.cmd run test:e2e
npm.cmd run eval:creative
```

真实模型评测不是部署前必须的自动步骤；配置后可按评测指南单独运行，记录实际调用结果。npm run preview只适合静态预览，当前项目没有为preview配置API代理，因此它不能替代完整部署。[Vite说明](https://vite.dev/guide/static-deploy.html)

## 2. 准备服务器、域名与访问方式

下面以新Ubuntu24.04、x86_64服务器、普通sudo用户ubuntu为例。若系统/架构不同，调整软件包与Node二进制。建议起步2vCPU、4GB内存，属于工程起点而非性能保证；本机浏览器承担音频计算。

将域名例如synth.example.com的A记录指向服务器IPv4；仅在IPv6正常时配置AAAA。云安全组只开放80、443，SSH端口仅对你可用；8787与5173不开放。此指南不启用CDN代理。

选择访问模式：

- 公开演示：先保持MODEL_CHAT_URL、MODEL_NAME为空，没有共享付费模型密钥，验证演奏、编辑和规则候选。
- 私人真实模型使用：Nginx仅允许你指定的公网IP访问/api，防止别人消耗共享密钥。IP变化后更新配置。
- 公开真实模型产品：先增加基于Cookie的登录/访问控制、用户配额及模型费用限制，再开放/api。本项目目前未实现这些能力；来源白名单不是用户认证。

以下Nginx示例采用私人API模式，静态网页仍公开。Bearer任务凭证已经占用Authorization头，不要在/api直接叠加Basic Auth，否则后续轮询可能认证失败。需要登录保护时采用保留任务Bearer头的Cookie认证或auth_request网关。

## 3. 安装服务器环境

登录：

```bash
ssh ubuntu@你的服务器IP
sudo apt update
sudo apt install -y nginx curl ca-certificates xz-utils snapd nano
```

从官方发行包安装Node22，下面固定22.23.3作为文档示例；上线时核对官方仍受支持的22.x版本。这里假设/opt/node22尚未用于其他应用。

```bash
mkdir -p /tmp/synthverse-node
cd /tmp/synthverse-node
curl -fsSLO https://nodejs.org/dist/v22.23.3/node-v22.23.3-linux-x64.tar.xz
curl -fsSLO https://nodejs.org/dist/v22.23.3/SHASUMS256.txt
sha256sum --check --ignore-missing SHASUMS256.txt
sudo mkdir -p /opt/node22
sudo tar -xJf node-v22.23.3-linux-x64.tar.xz -C /opt/node22 --strip-components=1
export PATH=/opt/node22/bin:$PATH
node --version
npm --version
```

校验失败不要继续解压。新SSH会话执行export PATH，或将该行加入你自己的shell配置。systemd会另外配置绝对路径，不依赖登录shell。

## 4. 上传当前源码

当前目录没有初始化Git仓库，可直接打包；不需要先创建GitHub仓库。Windows项目目录执行：

```powershell
Set-Location D:\Repos\SynthVerse
tar.exe -czf synthverse-src.tar.gz --exclude=synthverse-src.tar.gz --exclude=node_modules --exclude=.venv --exclude=dist --exclude=vital --exclude=.env --exclude=.env.* --exclude=.git --exclude=.artifacts --exclude=.codex --exclude=.agents --exclude=.aws --exclude=test-results --exclude=playwright-report --exclude=*.log .
scp .\synthverse-src.tar.gz ubuntu@你的服务器IP:/tmp/synthverse-src.tar.gz
```

不要打包.env密钥、本机node_modules或Vital源码。服务器重新安装Linux依赖。将源码解压到一个新的应用目录：

```bash
sudo mkdir -p /opt/synthverse
sudo chown "$USER":"$(id -gn)" /opt/synthverse
tar -xzf /tmp/synthverse-src.tar.gz -C /opt/synthverse
cd /opt/synthverse
export PATH=/opt/node22/bin:$PATH
npm ci
```

本方案保留devDependencies：API运行需要其中的tsx，所以不能在现有package.json下使用npm ci --omit=dev。后续若编译后端为独立JavaScript产物，可再设计更小的运行包。

## 5. 放行正式网页来源并构建

这是现有代码需要的一项修改；目前来源白名单仅含localhost。编辑services/api/server.ts，在createApiServer内、return http.createServer之前加入：

```typescript
const allowedOrigins = new Set([
  'http://127.0.0.1:5173',
  'http://localhost:5173',
  'http://127.0.0.1:8787',
  ...(process.env.APP_ALLOWED_ORIGINS ?? '')
    .split(',').map(value => value.trim()).filter(Boolean),
]);
```

将原来的硬编码判断：

```typescript
if (origin && !['http://127.0.0.1:5173', 'http://localhost:5173', 'http://127.0.0.1:8787'].includes(origin))
```

替换为下面的判断，并保留原来后面的return send(...)：

```typescript
if (origin && !allowedOrigins.has(origin))
```

不要删除来源检查、放行所有来源，或在Nginx伪造/清空Origin头。把这项修改也同步回本机源码，以免下次上传覆盖。

```bash
cd /opt/synthverse
npm run build
npm test
npm run eval
```

必须成功。dist是前端产物；API仍运行services/api和src里的TypeScript源码。仅上传dist不能获得完整Agent功能。

## 6. 配置后端环境与常驻服务

创建专用运行账户（已存在时跳过useradd）：

```bash
sudo useradd --system --user-group --home-dir /opt/synthverse --shell /usr/sbin/nologin synthverse
sudo install -m 600 /dev/null /etc/synthverse.env
sudo nano /etc/synthverse.env
```

install创建环境文件这一步仅用于首次部署，已有文件时不要执行以免清空。填入：

```dotenv
APP_ALLOWED_ORIGINS=https://synth.example.com
MODEL_CHAT_URL=
MODEL_NAME=
MODEL_API_KEY=
MODEL_EXECUTION_MODE=agent
```

演示阶段留空模型配置。私人真实模型阶段填写服务URL、模型ID和密钥，并设置供应商账户的预算限制。若本地模型也运行在该服务器，127.0.0.1:11434指的是服务器的模型服务，不是你的Windows电脑。

本示例由systemd读取root专属环境文件并注入进程，后端不会自动读取服务器项目目录里的.env。编辑/etc/systemd/system/synthverse.service：

```ini
[Unit]
Description=SynthVerse Agent gateway
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=synthverse
Group=synthverse
WorkingDirectory=/opt/synthverse
Environment=NODE_ENV=production
Environment=PATH=/opt/node22/bin:/usr/local/bin:/usr/bin:/bin
EnvironmentFile=/etc/synthverse.env
ExecStart=/opt/node22/bin/node /opt/synthverse/node_modules/tsx/dist/cli.mjs services/api/server.ts
Restart=on-failure
RestartSec=3
UMask=0077
NoNewPrivileges=true
PrivateTmp=true

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now synthverse
sudo systemctl status synthverse --no-pager
curl -fsS http://127.0.0.1:8787/api/status
```

预期返回mode=demo，或配置后的mode=model。model只说明配置存在，不证明供应商凭证和工具协议已经通过测试。

## 7. Nginx网页与API代理

编辑/etc/nginx/sites-available/synthverse，将域名和203.0.113.24替换成实际域名、你的公网IP：

```nginx
server {
    listen 80;
    server_name synth.example.com;
    root /opt/synthverse/dist;
    index index.html;
    client_max_body_size 1m;

    location /api/ {
        # 私人真实模型模式：只允许本人访问API。
        allow 203.0.113.24;
        deny all;

        # 此处无尾斜杠，保留/api/runs等原路径。
        proxy_pass http://127.0.0.1:8787;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 100s;
        proxy_send_timeout 100s;
        proxy_buffering off;
        add_header Cache-Control "no-store" always;
    }

    location /assets/ {
        try_files $uri =404;
        add_header Cache-Control "public, max-age=31536000, immutable";
    }

    location / {
        try_files $uri $uri/ /index.html;
        add_header Cache-Control "no-cache";
    }
}
```

公开无密钥演示时可去掉API段的allow/deny；接入共享付费密钥之前恢复访问保护。路径、请求体与Authorization头保持透传。[Nginx代理文档](https://nginx.org/en/docs/http/ngx_http_proxy_module.html)、[IP访问限制](https://nginx.org/en/docs/http/ngx_http_access_module.html)。

```bash
sudo ln -s /etc/nginx/sites-available/synthverse /etc/nginx/sites-enabled/synthverse
sudo nginx -t
sudo systemctl reload nginx
```

已有同名链接时跳过ln。Nginx的www-data需要读取dist且能穿过父目录；只给静态目录需要的读取权限，不用chmod777。HTTP网页暂时只用于签发证书，配置里来源仅允许HTTPS，因此此时部分API请求403是预期；不要为调试开放公网开发服务。

## 8. 启用HTTPS

DNS指向正确，80与443可达后：

```bash
sudo snap install --classic certbot
sudo /snap/bin/certbot --nginx -d synth.example.com
sudo nginx -t
sudo systemctl reload nginx
sudo /snap/bin/certbot renew --dry-run
```

按向导提供邮箱、接受条款并启用HTTP到HTTPS重定向。证书安装/续期方法依据[Certbot的Nginx指南](https://certbot.eff.org/instructions?ws=nginx&os=snap)。如果安装方式不是snap，使用其对应命令，不混装两种Certbot。

如果启用主机防火墙，先放行实际SSH端口再启用；如SSH为22，Ubuntu示例为sudo ufw allow OpenSSH、sudo ufw allow 'Nginx Full'、sudo ufw enable。云安全组和主机防火墙都要允许80/443。

## 9. 上线验收

在白名单IP访问https://synth.example.com，完成：

1. 页面与/api/status均正常，POST /api/runs不会403。
2. 上方琴键、旋律左侧琴键按下即响、按住持续、松开进入尾音；先进行用户点击激活浏览器音频。
3. 请求“音色柔和一点”，候选显示真实渲染指标，可试听、应用、撤销。
4. 打开执行记录，确认demo/model标签准确；真实模型应出现模型请求与音乐工具事件。
5. 选区编辑、和弦手动修改、取消生成和手动编辑取消任务正常。
6. 下载工程JSON、MIDI、WAV；刷新后恢复本机工程与候选归档。
7. 手机或另一台设备测试布局；其公网IP也必须被API白名单允许。
8. 重启网关后重新发起任务可用；重启时已有任务丢失是当前设计限制。

正式域名与localhost的IndexedDB互不共享，本机工程需导出后在新网址导入。跨设备不会自动同步。不要将服务状态mode=model误认为模型验收通过。

## 10. 日志、升级、备份与回滚

```bash
sudo journalctl -u synthverse -n 100 --no-pager
sudo journalctl -u synthverse -f
sudo tail -n 100 /var/log/nginx/error.log
```

更新时先保留上一版完整源码、dist和依赖版本对应的lockfile，将新版本部署到独立release目录并执行npm ci、build和相关测试。随后切换服务WorkingDirectory/ExecStart及Nginx root到同一新版目录，daemon-reload、重启服务、nginx -t和reload。不要在正在运行的目录里边覆盖源码边安装依赖，以免当前任务混用版本。

前端带哈希的旧assets保留一段时间或提示用户刷新，防止已打开的旧页面请求到不存在的资源。回滚时将服务和静态目录一起切回上一版，重新加载。变更会丢失正在执行的内存任务，用户需重新发起请求。

备份源码/release、lockfile、Nginx与systemd配置；环境密钥使用受控的秘密备份，不能放进Git或公开下载。工程和收藏在各用户浏览器，本机JSON导出是当前备份方式；备份服务器不会备份用户作品。

## 11. 常见问题与扩展边界

| 现象 | 排查 |
|---|---|
| 页面可打开，API403 | 检查Nginx IP限制与APP_ALLOWED_ORIGINS；域名/协议/端口需一致，不能带路径或结尾斜杠 |
| 页面有候选却标离线演示 | /api/status访问失败可能使前端进入离线规则；检查控制台与代理 |
| API502 | 网关进程、8787监听、服务日志；供应商失败也可能在Agent任务中显示错误 |
| 请求返回HTML、JSON解析失败 | /api被当成静态页面，检查proxy_pass路径和location |
| 任务不存在/结果过期 | 服务重启、超过模式时限（快速45秒、比较90秒）、任务取消、多个实例分流；保持单实例 |
| 模型响应但工具失败 | 模型是否支持tools、多轮协议；检查trace与格式/锁定/选区 |
| 真实模型请求过慢 | 快速45秒、比较90秒均含浏览器渲染；先选适合工具调用的模型、减少候选和上下文 |
| npm找不到tsx | 没有安装devDependencies，或service路径/PATH错误 |
| 声音第一次不响 | 浏览器需用户交互启动AudioContext，检查音量和声源；不是服务端声卡问题 |
| 本地模型连接不上 | 服务器127.0.0.1不是个人电脑；不同主机需明确可达地址与保护方式 |

目前不要使用无状态短时函数直接承载Agent任务，也不要启动PM2多实例/多副本随机分流：runId、token与等待渲染的Promise仅存在于单进程。需要扩容时先设计共享任务存储/队列、工作进程与结果路由；简单增加Redis变量不会自动解决等待中的执行器问题。

公开真实模型产品另需用户隔离、认证、配额、限流和模型预算。本指南的单机私人API/IP限制可用于个人部署；公开无密钥规则演示可用于展示原型。原始音频理解、音频生成、Vital/Serum原生预设和插件尚未实现，部署不会补齐这些功能。
