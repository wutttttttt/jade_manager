# 环境依赖、安装启动与复现约定

更新日期：2026-09-24 08:48 CST。依赖、PostgreSQL、API、基础集成检查和小程序构建已在当前 macOS 主机实跑。用户在普通终端执行扩展 `npm run test:integration` 返回 `integration: all assertions passed`，并成功将真实联合备份恢复到独立空库及媒体目录；当前执行沙箱仍无法连接本机数据库，数据库逐表内容比对待执行。

## 1. 实际版本

| 项目 | 固定 / 实测版本 | 状态 |
|---|---|---|
| Node.js / npm | `v24.19.0` / `11.17.0` | 通过 |
| PostgreSQL | Homebrew `16.15` | 已安装且基础库曾通过；当前沙箱内不可达 |
| `pg` | `8.16.3` | 基础 API/SQL 通过 |
| uni-app Vue 3 | `3.0.0-alpha-5020720260921001` | Compiler 5.27 构建通过 |
| Vue / Vite / TypeScript | `3.4.21` / `5.2.8` / `5.6.3` | 构建通过 |
| DCloud types | `3.4.31` | peer 依赖对齐 |
| ffmpeg | Homebrew `9.0.2` | 3 秒 H.264 MP4 合成素材已生成 |
| 微信开发者工具 | Stable `2.02.2608040` | 服务端口 `19554` 已开启；真实 AppID 未配置 |

直接依赖使用精确版本，传递依赖由根目录 `package-lock.json` 锁定。上次成功的 `npm audit --omit=dev` 有 32 项 DCloud 依赖树告警（12 low、9 moderate、11 high、0 critical）；2026-09-23 10:12 CST 复核受 registry DNS 阻断。不执行会降级不兼容包的 `audit fix --force`。

## 2. PostgreSQL 启停

安装和手动启动（未注册开机服务）：

```sh
brew install postgresql@16
/opt/homebrew/opt/postgresql@16/bin/pg_ctl \
  -D /opt/homebrew/var/postgresql@16 \
  -l /private/tmp/jade_manager_postgres.log start
```

首次创建合成数据专用角色和库：

```sh
/opt/homebrew/opt/postgresql@16/bin/createuser --login jade
/opt/homebrew/opt/postgresql@16/bin/psql -d postgres -c "alter role jade password 'jade';"
/opt/homebrew/opt/postgresql@16/bin/createdb --owner=jade jade_manager
```

停止：

```sh
/opt/homebrew/opt/postgresql@16/bin/pg_ctl -D /opt/homebrew/var/postgresql@16 stop
```

`jade/jade` 只用于监听 `127.0.0.1` 的本机合成数据，生产不得复用。Homebrew 安装 PostgreSQL 时自动清理了 `fzf`、`python@3.13`、`sqlite`、`mpdecimal`；本项目不依赖它们，未自动重装。

## 3. 安装、数据库与启动

```sh
cd /Volumes/mobile/Jade_manager
npm ci --ignore-scripts
cp .env.example .env
npm run db:init
npm run db:seed
npm run api
```

`db:init` 依次执行 `001_init.sql`、幂等的 `003_media.sql` 和 `004_staff.sql`；`db:seed` 应只对本地合成数据库执行。API 就绪文本为：

```text
jade api ready at http://127.0.0.1:3000
```

另开终端：

```sh
npm run check
npm run test:integration
npm run miniapp:build
```

扩展集成脚本检查了：媒体上传幂等、四种审核转换与访问边界；商品组创建/归属、多组+单客授权可见集、系数单独改价、单客价与最低价兜底；老板新增零权限伙计、授权、停用即时拒绝和伙计自提权拒绝；只获挂牌价权限时的字段裁剪、挂牌价写入与成本价拒绝；草稿批次入口拒绝、已发布批次顺序、访客仍只见公开货及撤销即时生效；以及原有的版本和跨档口检查。

## 4. 小程序与微信工具

```sh
npm run miniapp:build
/Applications/wechatwebdevtools.app/Contents/MacOS/cli open \
  --project /Volumes/mobile/Jade_manager/apps/miniapp/dist/build/mp-weixin \
  --lang zh
```

拿到用户自有 AppID 后，重新构建并只修改构建输出：

```sh
WECHAT_APPID='wx<16位十六进制值>' npm run miniapp:build:wechat
/Applications/wechatwebdevtools.app/Contents/MacOS/cli open \
  --project /Volumes/mobile/Jade_manager/apps/miniapp/dist/build/mp-weixin \
  --lang zh
```

构建已输出 16 个非元数据文件到 `apps/miniapp/dist/build/mp-weixin`。`miniapp:build:wechat` 会校验 `wx` 开头的 18 位 AppID，并仅写入被忽略的 `dist` 产物；源码 `manifest.json` 保持 `touristappid`，避免误提交真实 AppID。该替换流程已用保留的测试值验证并重建回默认输出。微信工具“安全”中的 CLI/HTTP 服务端口已按用户授权开启为 `19554`；未开启登录票据或自动信任。CLI 已能联通 IDE，但默认构建目录使用 `touristappid`，IDE 返回“不存在此 AppID”；不得借用其他项目 AppID，需在 IDE 登录对应开发者账号。

真机需将 API 显式开放到可信局域网并在构建时写入地址；默认仍只监听本机：

```sh
API_HOST=0.0.0.0 npm run api
VITE_API_BASE='http://<本机局域网IP>:3000' npm run miniapp:build
```

`VITE_API_BASE` 构建替换已用文档保留地址 `192.0.2.1` 验证，之后已重建回默认本机地址。只能在可信开发网络使用 `0.0.0.0`，生产必须关闭 `DEMO_MODE`并使用合法 HTTPS 域名。

商家页现可录入货号、名称、器型、颜色、证书来源和三项价格，上传图片/视频、审核媒体、批次发布和原生转发，以及配置客户商品组、单客授权、系数与专属看款启停。停用客户后，后续请求立即按访客处理，只保留无门槛可见集。批次入口仅携带批次 ID，服务端只接受已发布批次并按成员顺序返回，仍实时复核当前客户可见性、货品状态和报价。基础属性会随草稿恢复并在商家重开与客户看款展示；客户和商家审核视频都只在点击播放后加载。真机转发、相机、关闭重开草稿和弱网仍待真实 AppID 验证。

客户看款页每次重新显示都会刷新服务端结果；快速切换测试身份时忽略过期响应，避免旧客户的报价覆盖当前页面。服务端未识别已停用测试客户时，小程序明确提示当前展示访客公开商品。

若服务端请求失败，看款页不再回退显示内置商品及固定数字价；商品、媒体、联系方式和旧报价保持清空，仅提示暂不可用，避免网络故障时呈现已撤销权限或过期价格。

## 5. 媒体和备份恢复

`var/media` 当前含合成 SVG、PNG 与 H.264 MP4。上传接口只收 JPEG/PNG/WebP/MP4，单文件最大 20MB，服务端按哈希命名并用 `.part` 文件避免半写入成品。小程序选择与上传文件时从内容签名确定 MIME 类型，不依赖微信临时路径扩展名或旧草稿中缓存的类型；空文件和不支持的格式会在本地保存前拒绝。

创建数据库+媒体联合备份：

```sh
# 先在 API 终端按 Ctrl-C 正常停机，再确认离线备份
BACKUP_CONFIRM_OFFLINE=1 npm run backup
# 或指定仓库内的唯一目录
BACKUP_CONFIRM_OFFLINE=1 npm run backup -- backups/manual-2026-09-23
```

恢复到事先创建的独立空库；脚本拒绝与当前 `DATABASE_URL` 相同的目标，并要求目标库名显式确认：

```sh
/opt/homebrew/opt/postgresql@16/bin/createdb --owner=jade jade_manager_restore
RESTORE_DATABASE_URL='postgres://jade:jade@127.0.0.1:5432/jade_manager_restore' \
RESTORE_CONFIRM='jade_manager_restore' \
RESTORE_MEDIA_ROOT='./var/media-restore' \
npm run restore -- backups/manual-2026-09-23
```

联合备份要求 API 已停止，并用 `BACKUP_CONFIRM_OFFLINE=1` 显式确认，避免数据库快照与本地媒体在上传期间错位；未确认时脚本在创建目录前拒绝执行。残留的 `.part` 临时上传不会入包；媒体目录若含链接或其他特殊文件，或备份目标位于媒体目录内，备份立即失败。任一步失败会自动移除本次新建的不完整目录。恢复必须同时提供当前 `DATABASE_URL`，否则无法确认目标库独立并会拒绝执行；`backups` 目录不能是符号链接，清单、数据库包和媒体包都必须是普通文件。恢复前只接受不超过 64 KiB、版本 1 且含合法 SHA-256 的 `manifest.json`；大文件哈希按流计算，不整包读入内存。归档只允许普通文件和目录，拒绝绝对路径、`..`、链接、FIFO 或设备等特殊条目。媒体目标必须为仓库内的空目录，不能等于当前 `MEDIA_ROOT`（包括符号链接指向同一目录），且父目录须预先存在于仓库内；脚本在创建目标前检查父目录真实路径，拒绝借符号链接写到仓库外。随后在同盘临时目录完整解压媒体，成功后才运行单事务 `pg_restore`，最后原子替换媒体目录。媒体解压或数据库恢复报错时不会留下半恢复媒体目标；数据库与文件系统之间不具备跨资源事务，若数据库恢复成功后媒体替换失败，应保持 API 停机并在新目标库/目录重新演练。2026-09-24 用户普通终端已完成真实 PostgreSQL 联合恢复演练，逐表内容比对仍待执行。

恢复前另用 PostgreSQL 自带的 `psql` 检查目标库是否含用户表、视图、序列等对象；非空库在运行 `pg_restore` 前拒绝，须创建独立空库重试。

`pg_restore` 只对空库运行，使用 `--single-transaction --exit-on-error`；不使用 `--clean` 删除目标库已有对象。

恢复媒体目标也不能是当前 `MEDIA_ROOT` 的父目录或子目录；路径预检在创建新目标前拒绝嵌套，防止恢复内容混进当前媒体或备份。

本次恢复后的数据库内容尚需在可连接 PostgreSQL 的普通终端做只读比对。以下命令依次输出源库和恢复库中客户、货品、媒体记录、审计的行数与按完整行内容排序后的摘要；对应行应完全一致，不会修改数据：

```sh
for database_name in jade_manager jade_manager_restore_t1_20260924; do
  printf '%s\n' "$database_name"
  /opt/homebrew/opt/postgresql@16/bin/psql -X -At -F ' | ' -v ON_ERROR_STOP=1 \
    -d "postgres://jade:jade@127.0.0.1:5432/$database_name" \
    -c "SELECT 'customers', count(*), md5(coalesce(jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text)::text, '[]')) FROM customers t
UNION ALL SELECT 'goods', count(*), md5(coalesce(jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text)::text, '[]')) FROM goods t
UNION ALL SELECT 'media_assets', count(*), md5(coalesce(jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text)::text, '[]')) FROM media_assets t
UNION ALL SELECT 'audit_entries', count(*), md5(coalesce(jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text)::text, '[]')) FROM audit_entries t"
done
```

## 6. 配置、秘密与实际验证

`.env` 由 `.gitignore` 排除。`DEMO_MODE=1` 只在非生产环境开放 `/api/demo/*`；`API_HOST` 默认 `127.0.0.1`。禁止提交真实手机号、AppSecret、会话密钥、生产数据库、证书原图、私密视频或备份包。

| 命令 / 环节 | 结果 |
|---|---|
| `npm install --ignore-scripts` | 通过：545 个包，已生成锁文件 |
| 原始 `db:init` / `db:seed` / API / 基础 `test:integration` | 通过，且基础集成脚本重复通过 |
| 2026-09-23 15:59 `npm run check` | 通过：11/11 测试、4 份 API TypeScript 静态检查、4 份脚本语法检查；扩展集成脚本含批次入口断言 |
| 2026-09-23 15:59 `npm run miniapp:build` | 通过：Compiler 5.27，原生批次分享按钮及入口参数已编译，16 个非元数据输出文件 |
| `WECHAT_APPID=wx0123456789abcdef npm run miniapp:build:wechat` | 通过：测试 AppID 只写入构建输出；随后普通构建已恢复默认 `touristappid` |
| 2026-09-23 20:41 干净临时目录离线 `npm ci` + `check` + `miniapp:build` | 通过：545 个包、12/12 测试、4 份 API 静态检查、4 份脚本语法检查、16 个非元数据输出文件；四种客户身份、货品撤销/恢复和原生分享均在产物中，临时目录已清理 |
| 2026-09-23 22:30 当时的扩展集成尝试 | 当时未实跑：宿主 PostgreSQL/API 的 TCP 端口在任务沙箱内不可达；工作区内独立 `initdb` 即使指定 `dynamic_shared_memory_type=mmap` 与 `shared_memory_type=mmap`，引导进程仍因 `shmget: Operation not permitted` 失败，失败目录已清理。09-24 用户普通终端已运行扩展集成并通过，见后续记录 |
| 自动化备份/恢复控制测试 | 通过：伪 pg 工具下实际打包/解包、SHA-256、媒体对比、当前库/篡改/危险路径/链接拒绝；真实 pg 演练待执行 |
| 2026-09-23 17:15 备份/恢复故障保护 | 通过：未确认 API 离线时拒绝备份；备份失败不残留目录；媒体预解压失败时未启动 `pg_restore`；恢复含单事务并拒绝未知版本和特殊条目 |
| 2026-09-23 17:16 `npm run check && npm run miniapp:build` | 通过：11/11 测试、API 静态检查、4 份脚本语法检查、Compiler 5.27、16 个非元数据输出文件及原生批次分享产物 |
| 2026-09-23 18:01 媒体落盘事务回归 | 通过：落盘失败在提交前触发事务回滚，幂等重试仍执行落盘；完整 `check` 12/12、Compiler 5.27 构建通过 |
| 2026-09-23 18:56 临时媒体写入清理 | 通过：`writeFile` 纳入既有失败清理块；完整 `check` 12/12、Compiler 5.27 构建通过 |
| 2026-09-23 20:35 T1 界面补齐 | 通过：客户页第四种 `customer-list` 身份、商家货品撤销/恢复按钮均已编译进微信产物；完整 `check` 12/12、Compiler 5.27 构建通过 |
| 2026-09-23 21:10 客户启停闭环 | 通过：客户状态随设置原子保存并记审计，商家页启停开关已编译进 16 个文件的微信产物；扩展集成脚本已加停用退回访客集及恢复断言，完整 `check` 12/12、Compiler 5.27 构建通过 |
| 2026-09-23 22:04 看款权限刷新 | 通过：共享 `canView` 判定用于服务端列表，扩展集成脚本增加停用前后私有商品与媒体访问断言；小程序在 `onShow` 刷新并忽略过期身份响应，停用提示已编译。`check` 12/12、Compiler 5.27 构建通过；扩展集成脚本仍待可访问 PostgreSQL 后实跑 |
| 2026-09-23 22:10 恢复目标预检 | 通过：媒体父目录的真实路径在创建目标前验证；符号链接指向项目外时，模拟恢复拒绝且未创建外部文件。完整 `check` 12/12、备份恢复专项 1/1 通过；真实 PostgreSQL 演练仍待执行 |
| 2026-09-23 22:32 备份目标重叠保护 | 通过：`MEDIA_ROOT=./backups` 时在创建备份目录前拒绝，避免将正在生成的备份重新打包；完整 `check` 12/12 通过 |
| 2026-09-23 22:35 数据库恢复失败清理 | 通过：模拟 `pg_restore` 返回失败，确认使用单事务参数、媒体目标保持空目录且预解压临时目录无残留；完整 `check` 12/12 通过。真实 PostgreSQL 恢复仍待演练 |
| 2026-09-23 22:41 媒体内容识别 | 通过：JPEG/PNG/WebP/MP4 按文件签名识别，类型不匹配时拒绝；上传时重算旧草稿 MIME。完整 `check` 13/13、Compiler 5.27 构建通过，16 个非元数据输出文件。真机路径与相机返回值仍待自有 AppID 验证 |
| 2026-09-23 22:45 项目内干净副本离线复现 | 通过：`npm ci --ignore-scripts --offline` 安装 545 个包，`check` 13/13 与 API/脚本检查通过，Compiler 5.27 输出 16 个非元数据文件并含媒体签名识别；临时副本已清理。离线 npm 未获取最新安全公告，不能据此推翻上次在线审计的 32 项告警 |
| 2026-09-23 22:49 恢复媒体目录保护 | 通过：恢复媒体目标等于当前 `MEDIA_ROOT` 时，即使空目录也拒绝，且不启动 `pg_restore`；备份恢复专项 1/1、完整 `check` 13/13 通过。当前媒体目录不存在时也能正常预检 |
| 2026-09-23 22:50 数据库/API 连接复核 | 未通过：`pg_isready -h 127.0.0.1 -p 5432` 无响应，`curl --max-time 3 http://127.0.0.1:3000/health` 连接失败；因此未再次执行最新迁移和扩展集成脚本 |
| 2026-09-23 23:21 商品组媒体撤权与 JSON 边界 | 集成脚本已增加商品组撤销/恢复时直接媒体读取的 200→404→200 断言、非对象 JSON 返回 400 断言；`node --check` 与完整 `npm run check` 13/13 通过。23:20 复查数据库/API 端口仍不可达，新增请求断言尚未实跑 |
| 2026-09-23 23:33 JSON 请求边界单测 | 将共享请求体解析隔离成可直接测试的模块，验证对象/空体通过，`null`/数组/数字/字符串/畸形 JSON 返回 400，超过 1MB 返回 413；完整 `npm run check` 14/14 通过。小程序构建仍为 Compiler 5.27 通过 |
| 2026-09-23 23:39 备份恢复大文件与链接输入保护 | SHA-256 改为标准库流式计算；恢复拒绝符号链接 `backups` 目录及链接备份输入文件。备份恢复专项 1/1、完整 `npm run check` 14/14 通过；真实 PostgreSQL 恢复仍待演练 |
| 2026-09-23 23:42 恢复清单体积边界 | 超过 64 KiB 的清单在读取/解析前拒绝，模拟测试确认未启动 `pg_restore`；完整 `npm run check` 14/14 通过。23:40 PostgreSQL 5432 与 API 3000 仍不可达 |
| 2026-09-23 23:45 定价不授予可见性 | 领域测试新增“仅有系数/单客价但无组或单客授权时无报价”，完整 `npm run check` 14/14 通过；PostgreSQL 5432 与 API 3000 仍不可达，扩展集成未实跑 |
| 2026-09-23 23:53 视频上传验收准备 | 扩展集成脚本新增合成 MP4 上传、待审直接读取拒绝、审核通过后 206 Range/`video/mp4` 和客户列表视频引用断言；完整 `npm run check` 14/14、脚本语法通过。PostgreSQL/API 仍不可达，新增 HTTP 场景待实跑 |
| 2026-09-23 23:56 合成 MP4 实际解码 | `ffprobe` 确认为 MP4 容器、H.264、640×480、3.000 秒、175200 字节；`ffmpeg -v error -i var/media/demo-video.mp4 -f null -` 无错误完成。PostgreSQL/API 端口仍不可达，不能据此替代 HTTP/微信真机验证 |
| 2026-09-24 00:06 本轮复验 | `npm run check` 14/14 通过，API TypeScript 与 4 份脚本语法检查通过；`npm run miniapp:build` Compiler 5.27 通过。`pg_isready -h 127.0.0.1 -p 5432` 无响应，`curl http://127.0.0.1:3000/health` 连接失败；扩展集成和真实恢复仍未执行 |
| 2026-09-24 02:15 恢复目标空库保护 | 恢复脚本新增 `psql` 对目标库非系统对象的检查；模拟非空目标时拒绝且未启动 `pg_restore`。完整 `npm run check` 14/14、API 类型检查和脚本语法检查通过；真实 PostgreSQL 演练仍待连接可用 |
| 2026-09-24 03:16 看款失败不显示旧价 | 删除客户端离线商品样例，API 请求失败时仅展示暂不可用提示；`npm run check` 14/14、API 类型与脚本检查通过，`npm run miniapp:build` Compiler 5.27 通过。PostgreSQL 5432、API 3000、微信工具 19554 在当前沙箱内均不可达；真机行为待自有 AppID 验证 |
| 2026-09-24 04:13 恢复进一步收紧 | 空库预检后移除 `pg_restore --clean --if-exists`，改为单事务且显式遇错即停；模拟参数及故障测试通过，`npm run check` 14/14、API 类型和脚本语法检查通过。真实数据库恢复仍待连接可用 |
| 2026-09-24 05:14 媒体目录重叠保护 | 恢复拒绝当前媒体根目录的父/子目录，模拟子目录目标时在创建目录和运行 `pg_restore` 前拒绝；`npm run check` 14/14、API 类型及脚本语法检查通过。PostgreSQL/API/微信工具端口仍不可达 |
| 2026-09-24 08:37 扩展 HTTP 集成 | 用户从项目目录在普通 Mac 终端运行 `npm run test:integration`，提供的完整结束输出为 `integration: all assertions passed`。覆盖媒体上传/审核、客户可见性/报价、权限、批次、版本与跨档口等脚本断言；迁移命令的单独输出未提供，不将其单独记为已验证。此任务沙箱仍无法连接 PostgreSQL/API；真实备份恢复与微信真机未执行 |
| 2026-09-24 08:45 联合备份与恢复 | 用户先停止 API，再用 `BACKUP_CONFIRM_OFFLINE=1 npm run backup -- backups/t1-20260924` 成功备份，并创建 `jade_manager_restore_t1_20260924` 独立空库；`npm run restore -- backups/t1-20260924` 成功恢复到该库及 `var/media-restore-t1-20260924`。备份来自 PostgreSQL `16.15`，清单的两份 SHA-256 与实际文件一致；恢复媒体 6 个业务文件与源目录逐项一致，源目录仅多出被备份排除的 macOS `._*` 元数据。数据库逐表内容尚未比对，当前任务沙箱 `pg_isready` 仍无响应 |
| 微信 CLI | IDE/19554 连通；真实 AppID 构建命令已就绪，实际导入仍受缺少自有 AppID及当前 Mac 锁屏阻塞 |
| 最新 `npm audit --omit=dev` 复核 | 未执行：DNS 无法解析 `registry.npmjs.org`；保留下方上次成功审计结果 |

恢复数据库验证的精确命令：当前宿主进程表显示 PostgreSQL PID `14628` 及 API Node 进程仍在运行；沙箱内不得删除 `postmaster.pid` 或再启动第二实例。在普通本机终端确认现有服务可连接后执行 `npm run db:init && npm run db:seed`，正常停止旧 API 并重启 `npm run api`，另开终端执行 `npm run test:integration`。这是执行环境限制，不是代码编译错误。
