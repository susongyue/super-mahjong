# 超能力立直麻将

> 多人联机角色选角对战 — 76 名超能力角色、策略博弈、实时对抗
> 目前只通过线上选角随后在线下对战，后续玩法待更新

---

## 🚀 在线体验

| 平台 | 地址 |
|------|------|
| **Railway** | `https://super-mahjong.up.railway.app` |
| **CloudBase** | `https://super-mahjong-267217-4-1324905494.sh.run.tcloudbase.com` |

---

## 🎮 玩法概览

```
注册/登录 → 创建或加入房间 → 全员准备 → 随机分配 6 名角色
→ 每回合暗选 1 人出战 → 统一揭晓 → 投票推进或结束 → 循环
```

- **暗选出战**：选将阶段其他玩家仅可见选择状态，无法知晓所选角色
- **休息轮换**：已出战的角色次回合进入休息，持有「保留」属性的角色可连续出战
- **全员投票**：各阶段推进均需全体玩家同意方可继续

---

## 🔧 技术栈

| 组件 | 技术 |
|------|------|
| 后端 | Express 5 + Socket.IO 4 |
| 数据库 | **Supabase** (PostgreSQL) |
| 头像存储 | **CloudBase** 云存储 |
| 前端 | 原生 HTML/CSS/JS |
| 部署 | Railway / CloudBase CloudRun |

---

## 📋 前置准备

部署前需注册以下云服务：

| 服务 | 用途 | 注册地址 |
|------|------|----------|
| **Supabase** | 用户、房间及对局数据持久化 | [supabase.com](https://supabase.com) |
| **CloudBase** | 自定义头像上传存储 | [console.cloud.tencent.com](https://console.cloud.tencent.com) |

---

## ⚙️ 数据库配置

### 1. Supabase 建表

在 Supabase **SQL Editor** 中执行以下语句创建所有表：

```sql
-- 用户表
CREATE TABLE IF NOT EXISTS users (
  username TEXT PRIMARY KEY,
  password TEXT NOT NULL,
  nickname TEXT DEFAULT '',
  avatar TEXT DEFAULT '',
  bio TEXT DEFAULT '',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 角色表
CREATE TABLE IF NOT EXISTS characters (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  faction TEXT DEFAULT '',
  tier TEXT DEFAULT '',
  "limit" TEXT DEFAULT '',
  passive TEXT DEFAULT '',
  innate TEXT DEFAULT '',
  extra TEXT DEFAULT '',
  note TEXT DEFAULT '',
  image TEXT DEFAULT '',
  retain BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 房间表
CREATE TABLE IF NOT EXISTS rooms (
  room_id TEXT PRIMARY KEY,
  host TEXT NOT NULL,
  players TEXT[] DEFAULT '{}',
  status TEXT DEFAULT 'waiting',
  draft_method TEXT DEFAULT '',
  round INTEGER DEFAULT 0,
  started BOOLEAN DEFAULT FALSE,
  max_players INTEGER DEFAULT 4,
  started_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Socket 房间状态
CREATE TABLE IF NOT EXISTS socket_rooms (
  room_id TEXT PRIMARY KEY,
  data JSONB DEFAULT '{}',
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 选角结果
CREATE TABLE IF NOT EXISTS draft_results (
  room_id TEXT PRIMARY KEY,
  results JSONB DEFAULT '{}',
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 角色状态（休息/保留）
CREATE TABLE IF NOT EXISTS character_states (
  room_id TEXT PRIMARY KEY,
  states JSONB DEFAULT '{}',
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 出战选择
CREATE TABLE IF NOT EXISTS battle_selections (
  room_id TEXT PRIMARY KEY,
  selections JSONB DEFAULT '{}',
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 历史对局
CREATE TABLE IF NOT EXISTS game_history (
  room_id TEXT PRIMARY KEY,
  game_id TEXT,
  players TEXT[] DEFAULT '{}',
  draft_results JSONB DEFAULT '{}',
  battle_history JSONB DEFAULT '[]',
  host TEXT DEFAULT '',
  total_rounds INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  started_at TIMESTAMPTZ,
  ended_at TIMESTAMPTZ DEFAULT NOW()
);

-- RLS 策略（允许公开读写）
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE characters ENABLE ROW LEVEL SECURITY;
ALTER TABLE rooms ENABLE ROW LEVEL SECURITY;
ALTER TABLE socket_rooms ENABLE ROW LEVEL SECURITY;
ALTER TABLE draft_results ENABLE ROW LEVEL SECURITY;
ALTER TABLE character_states ENABLE ROW LEVEL SECURITY;
ALTER TABLE battle_selections ENABLE ROW LEVEL SECURITY;
ALTER TABLE game_history ENABLE ROW LEVEL SECURITY;

-- 为每张表创建宽松策略
DO $$
DECLARE t TEXT;
BEGIN
  FOR t IN SELECT tablename FROM pg_tables WHERE schemaname='public'
  LOOP
    EXECUTE format('CREATE POLICY "允许公开读写" ON %I FOR ALL USING (true) WITH CHECK (true)', t);
  END LOOP;
END $$;

-- ═══ 迁移：已有数据库执行以下 ALTER（IF NOT EXISTS 安全，已有则跳过） ═══
ALTER TABLE rooms ADD COLUMN IF NOT EXISTS started_at TIMESTAMPTZ;
ALTER TABLE game_history ADD COLUMN IF NOT EXISTS started_at TIMESTAMPTZ;
```

### 2. 导入角色数据

首次部署时，服务器启动会自动将 `data/characters.json` 导入 Supabase `characters` 表。

### 3. CloudBase 头像存储

1. 打开 [腾讯云控制台](https://console.cloud.tencent.com/cam/capi) → 获取 `SecretId` 和 `SecretKey`
2. 确保 CloudBase 环境已开通云存储

---

## 🔐 环境变量

创建 `.env` 文件并在部署平台配置以下环境变量：

```env
# ── Supabase（必须） ──
SUPABASE_URL=https://xxxxxxxxxxxx.supabase.co
SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIs...

# ── CloudBase 云存储（头像上传，必须） ──
TENCENT_SECRET_ID=AKIDxxxxxxxxxxxxxxxxxxxxxxxxxx
TENCENT_SECRET_KEY=xxxxxxxxxxxxxxxxxxxxxxxxxxxxx

# ── 可选 ──
PORT=3000
```

---

## 🏠 本地运行

```bash
npm install
# 开发模式（文件改动自动重启）
npm run dev
# 或生产模式
npm start
# 访问 http://localhost:3000
```

---

## ☁️ 部署到 Railway

1. Fork/推送本项目到 GitHub
2. 在 [Railway](https://railway.app) 中 **New Project → Deploy from GitHub repo**
3. 在 **Variables** 中添加上述 4 个环境变量
4. Railway 自动检测 Dockerfile 并部署

| 变量 | 值来源 |
|------|--------|
| `SUPABASE_URL` | Supabase Project Settings → API |
| `SUPABASE_ANON_KEY` | Supabase Project Settings → API |
| `TENCENT_SECRET_ID` | 腾讯云 CAM → API 密钥 |
| `TENCENT_SECRET_KEY` | 腾讯云 CAM → API 密钥 |

---

## ☁️ 部署到 CloudBase

```bash
tcb run deploy --name super-mahjong
```

推荐配置：0.5 核 CPU / 1GB 内存 / 端口 3000

---

## 📁 项目结构

```
super-mahjong/
├── server.js              # 主服务器（Express + Socket.IO）
├── package.json
├── Dockerfile
├── .env                   # 环境变量（不提交到 Git）
├── cloudbaserc.json       # CloudBase 部署配置
│
├── data/
│   └── characters.json    # 角色数据（首次部署时导入 Supabase）
│
├── public/                # 前端页面
│   ├── login.html         # 登录/注册
│   ├── lobby.html         # 大厅（房间列表/历史记录）
│   ├── index.html         # 房间（准备/投票/选角）
│   ├── game.html          # 选将（出战选择）
│   └── battle_round.html  # 回合对战（揭晓/投票）
│
└── tools/
    └── migrate_characters.sql  # Supabase 建表 SQL
```

---

## 🃏 角色系统

76 个角色，4 种技能，5 个强度等级：

| 技能类型 | 说明 |
|---------|------|
| 🎯 **限定技** | 每局限定次数的大招 |
| ⚡ **固有技** | 角色天生能力 |
| 🔄 **被动技** | 持续生效 |
| ➕ **附加技** | 额外技能 |

| 等级 | T0 | T1 | T2 | T3 |
|------|----|----|----|-----|
| 定位 | 顶级 | 强力 | 中等 | 一般 |

---

## 📡 API 参考

| 方法 | 路由 | 功能 |
|------|------|------|
| `POST` | `/api/register` | 注册 |
| `POST` | `/api/login` | 登录 |
| `POST` | `/api/create-room` | 创建房间 |
| `POST` | `/api/join-room` | 加入房间 |
| `GET` | `/api/characters` | 获取角色列表 |
| `POST` | `/api/upload-json` | 上传角色 JSON |
| `GET` | `/api/rooms` | 活跃房间列表 |
| `GET` | `/api/game-history` | 历史对局 |
| `GET` | `/api/room-status` | 房间状态（断线重连） |
| `POST` | `/api/upload-avatar` | 上传自定义头像 |

> Socket 事件：`joinRoom` · `toggleReady` · `voteSelect` · `selectBattleCharacter` · `voteEndRound` · `voteEndGame` · `getRoomState`

---

## ❓ 常见问题

> **Q: 支持几人游玩？**  
> 最少 2 人，最多 4 人。

> **Q: 中途断线如何恢复？**  
> 重新登录后大厅会自动检测未完成的对局并提示重连，对局状态不会丢失。

> **Q: 部分角色为何不可选择？**  
> 已出战的角色需要休息一回合后方可再次使用。带有金色虚线边框的角色具有「保留」属性，不受此限制。

> **Q: 服务器重启会丢失数据吗？**  
> 不会。所有用户、房间、对局数据均实时持久化至 Supabase。

---

<div align="center">
  <sub>仅供学习交流 · 角色数据版权归原作者</sub>
</div>
