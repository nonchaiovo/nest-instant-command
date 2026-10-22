-- 即时指令（Cloudflare D1 / SQLite）
CREATE TABLE IF NOT EXISTS commands (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  title             TEXT    NOT NULL,
  countdown_seconds INTEGER,              -- 可选倒计时秒数；NULL = 不计时，药丸显示已过时间
  created_at        INTEGER NOT NULL,     -- 毫秒
  started_at        INTEGER,              -- 前端首次显示时回写，用来算真实用时
  created_by        TEXT    NOT NULL DEFAULT 'ai'
);
CREATE INDEX IF NOT EXISTS idx_commands_created ON commands (created_at);

-- 完成反馈暂存（下一轮注入给 AI 后清空）
CREATE TABLE IF NOT EXISTS settings (k TEXT PRIMARY KEY, v TEXT);
