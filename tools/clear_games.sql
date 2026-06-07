-- ═══ 清空所有对局数据 ═══
-- 在 Supabase SQL Editor 中执行：https://supabase.com/dashboard/project/rvdvdgriyleoiuglzgch/sql

DELETE FROM battle_selections;
DELETE FROM character_states;
DELETE FROM draft_results;
DELETE FROM socket_rooms;
DELETE FROM game_history;
DELETE FROM rooms;

-- 验证
SELECT 'battle_selections' AS tbl, COUNT(*) FROM battle_selections
UNION ALL SELECT 'character_states', COUNT(*) FROM character_states
UNION ALL SELECT 'draft_results', COUNT(*) FROM draft_results
UNION ALL SELECT 'socket_rooms', COUNT(*) FROM socket_rooms
UNION ALL SELECT 'game_history', COUNT(*) FROM game_history
UNION ALL SELECT 'rooms', COUNT(*) FROM rooms;
