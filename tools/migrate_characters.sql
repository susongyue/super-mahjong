-- 角色数据表迁移 SQL
-- 在 Supabase SQL Editor 中执行: https://supabase.com/dashboard/project/_/sql
-- 或者 server.js 启动时自动尝试创建

CREATE TABLE IF NOT EXISTS characters (
  id TEXT PRIMARY KEY,
  faction TEXT DEFAULT '',
  name TEXT NOT NULL,
  tier TEXT DEFAULT '',
  "limit" TEXT DEFAULT '',
  passive TEXT DEFAULT '',
  innate TEXT DEFAULT '',
  extra TEXT DEFAULT '',
  note TEXT DEFAULT '',
  image TEXT DEFAULT '',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 启用 RLS 但允许所有操作（公开角色数据）
ALTER TABLE characters ENABLE ROW LEVEL SECURITY;
CREATE POLICY "允许公开读取" ON characters FOR SELECT USING (true);
CREATE POLICY "允许管理写入" ON characters FOR INSERT WITH CHECK (true);
CREATE POLICY "允许管理更新" ON characters FOR UPDATE USING (true);
CREATE POLICY "允许管理删除" ON characters FOR DELETE USING (true);
