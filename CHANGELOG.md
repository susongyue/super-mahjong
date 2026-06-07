# Changelog

All notable changes to super-mahjong will be documented in this file.

---

## v1.2.1 (2026-06-07)

### 稳定性修复
- **GSAP 崩溃防护**：所有页面 `gsap.from/to` 调用改为 `Utils.safeAnimate()` 包装，CDN 加载失败时静默跳过而非阻断后续 JS 执行
- **工具函数增强**：`Utils` 新增 `safeAnimate()`、`setBtnLoading()`、`resetBtn()` 用于安全动画和按钮反馈
- **创建房间**：`saveRooms()` 改为 `await` 等待 Supabase 持久化，添加 try-catch 错误处理
- **加入房间**：`.single()` 改为 `.maybeSingle()`，避免空结果抛异常

### 管理员面板修复
- 新增 `GET /api/admin/check` 轻量检测端点（不返回 403，避免前端误判）
- `checkIsAdmin()` 改用新端点 + Console 日志输出，方便排查配置问题

### 交互反馈增强
- 大厅"创建房间"按钮：点击后显示"创建中…" + 禁用态，失败自动恢复
- 大厅"进入房间"按钮：点击后显示"查询中…" + 禁用态

### 动画补充
- `profile.html` 管理员面板 `.admin-section` 纳入入场动画序列
- 所有页面 GSAP 调用统一使用安全回退机制

---

## v1.2.0 (2026-06-07)

### 头像系统增强
- **跨页头像同步**：非登录页页面加载时自动从服务端拉取最新头像到 localStorage，解决重启后头像需进个人主页才刷新的问题
- **大厅玩家头像**：`/api/rooms` 返回 `playerDetails` 含头像 CDN URL，大厅活跃房间列表展示玩家头像
- **头像历史记录**：上传自定义头像后旧头像不再删除，改为保存到历史（最多 10 个）
- **历史头像切换**：个人主页新增「历史头像」区域，点击缩略图可切换回之前上传的头像

### Bug 修复
- **对局详情加载失败**：`/api/game-history-detail` 的 `.single()` 改为 `.maybeSingle()`，避免空结果抛异常被静默吞掉
- **回合切换动画**：`updateRoundView` 改为 `replaceChild` + 渐入渐出，消除双容器垂直堆叠问题

### 管理员面板
- 新增环境变量 `ADMIN_USERS`（逗号分隔的用户名列表），标记管理员
- 个人主页底部新增「管理员面板」：查看服务器运行状态（运行时长/内存/在线人数等）+ 一键重启
- 新增 API：`GET /api/admin/status`、`POST /api/admin/restart`

### 后端
- `loadFromDB` 支持从 Supabase 恢复 `avatar_history` 字段
- `updateUserInDB` 支持写入 `avatar_history` 数组
- 新增 API：`GET /api/avatar-history`、`POST /api/use-avatar`

---

## v1.1.0 (2026-06-07)

### 对局历史改造
- **唯一对局 ID**：`game_history` 新增 `game_id` 字段，格式 `g` + timestamp36 + random36，持久化存储
- **排序模式**：时间正序 ↑ / 倒序 ↓ 按钮切换，默认倒序（新→旧）
- **ID 搜索**：输入框防抖 350ms，支持按 `game_id` 或 `room_id` 搜索
- **回合回放**：详情弹窗新增"回合回放"标签，每回合可查看每个玩家选择的出战角色
- **回合导航**：◀ ▶ 按钮切换回合，带 opacity+translateY 过渡动画
- **后端**：`voteEndRound` 自动保存每轮出战选择到 `roundBattleHistory`；`saveGameHistory` 写入 `battle_history` JSONB；API 支持 `sort`/`search`/`gameId` 参数
- **前端**：`history.html` 全面重写（工具栏 + 卡片 + 详情弹窗双标签 + 回合导航）

### 角色图鉴动画
- 搜索/筛选切换：旧卡片逐一出场（0.2s）→ 新卡片逐次入场（0.35s stagger）
- Stagger 延迟防止卡片同时出现，`isRendering` 锁防止快速切换时动画重叠

### 对局历史工具栏重排
- **布局**：刷新按钮移入工具栏，排列为 刷新 → 排序下拉 → 搜索框 → 记录数量
- **排序改为下拉式**：点击展开菜单（时间倒序/时间正序），选择后自动刷新列表；带 ✓ 高亮当前选项和 fade 动画

### 角色图鉴双行布局
- 工具栏从单行 flex 改为纵向两行：
  - 第一行：筛选 chips（全部 / T0 / T1 / T2 / T3）
  - 第二行：搜索框 + 统计条（显示 N 名角色 · 各 tier 数量）

### 投票去重漏洞修复
- **根因**：`roundEndVotes` / `gameEndVotes` 用 `socket.id` 做投票 key，刷新页面后 socket.id 变更，同一玩家可重复投票（4人投票 → 1人刷4票）
- **修复**：改用 `player.name`（用户名，持久标识）做投票 key
- `voteEndRound` / `voteEndGame`：新增 `player` 查找容错（找不到则忽略投票）；`votedNames` 计算从 `p.id` 改为 `p.name`
- `disconnect`：断开连接时清理该玩家名在 `roundEndVotes` / `gameEndVotes` 中的残留记录
- `getRoomState`：投票计数只统计当前在线玩家，过滤孤立 socket.id 投票

### Bug 修复
- 排序下拉按钮 HTML 标签显示为纯文本（`textContent` → `innerHTML`）

### 对局开始时间戳
- `rooms` 和 `game_history` 新增 `started_at TIMESTAMPTZ` 列，记录每场对局的实际开始时间
- 4 处游戏开始点统一设置 `rooms[roomId].startedAt`：`/api/start-game`、`/api/draft-results`、`voteResult`、`draftAllDone`
- `saveRooms` / `saveGameHistory` 写入 `started_at` 到 Supabase
- `loadFromDB` 加载时保留 `startedAt` 字段
- 已有数据库迁移：`ALTER TABLE rooms/game_history ADD COLUMN IF NOT EXISTS started_at`

### 新增 CHANGELOG.md
- 版本变更记录文件，每次改动后追加更新

---

## v1.0.0 (2026-06-07)

### 架构迁移
- **全面迁移到 Supabase**：用户、房间、角色、对局历史、选角结果、socket_rooms 全部存储在 Supabase
- **移除本地存储**：删除 `DATA_DIR`、本地 JSON 读写、`fs.mkdirSync` 等依赖
- **CloudBase 头像存储**：用户头像上传到 CloudBase 云存储（`cloud://` fileID），通过临时 CDN URL 展示

### 角色数据管理
- 角色数据从本地 `characters.json` 迁移到 Supabase `characters` 表
- 移除 CSV 上传端点，仅保留 JSON 上传（同步写 Supabase + 本地备份）
- 76 个角色技能术语统一 + 发动时机明确化

### 新页面
- **角色图鉴**（`encyclopedia.html`）：网格展示、Tier 筛选、名称搜索、详情弹窗
- **对局历史**（`history.html`）：独立页面展示玩家历史对局

### UI 优化
- **Impeccable UI**：恢复浏览器缩放、键盘焦点样式、减少动画偏好、4px 网格对齐、品牌绿色调
- **详情弹窗统一**：居中卡片式详情弹窗替代全屏展开，CSS transition 渐显替代 GSAP 长动画
- **导航栏全站统一**：7 个页面新增"角色图鉴"链接；全局 navbar 遮挡修复
- **移动端优化**：login/lobby 页面 `100dvh` 居中、input/btn ≥44px、`font-size: 16px` 防 iOS 缩放
- **禁止页面右侧水平滚动条**

### Bug 修复
- `profile.html`：补充 GSAP CDN、navbar 数据同步、avatar 安全兜底
- `login.html` 设为首页路由 `/`
- `index.html` `.room-header` 导航栏遮挡修复
- xlsx 同步脚本格式保护加固（模板提取、K列保护、格式注入）

### CloudBase 部署
- Dockerfile（Node 22 Alpine / 端口 3000）
- CloudRun 容器部署：`https://super-mahjong-267217-4-1324905494.sh.run.tcloudbase.com`
- 环境 ID：`sr-mahjong-d0g8mp6w19f37dd37`（上海）

### 数据持久化
- `draftPools` / `finishedRooms` 内存数据持久化到 Supabase
- 服务器重启自动恢复选角池和已结束房间标记
