// 本地演示用的假后端：用 localStorage 模拟 server/ 里的四个接口和完成反馈。
// 换成真后端时删掉这个文件，提供同名的 api(method, path) 即可。
(() => {
  const KEY = "instant-command-demo";
  const load = () => { try { return JSON.parse(localStorage.getItem(KEY)) || { seq: 0, items: [], feedback: [] }; } catch { return { seq: 0, items: [], feedback: [] }; } };
  const save = (db) => { try { localStorage.setItem(KEY, JSON.stringify(db)); } catch {} };

  function humanDuration(ms) {
    const s = Math.round(ms / 1000);
    if (s < 60) return s + " 秒";
    const m = Math.floor(s / 60), rs = s % 60;
    if (m < 60) return rs ? `${m} 分 ${rs} 秒` : `${m} 分`;
    const h = Math.floor(m / 60), rm = m % 60;
    return rm ? `${h} 小时 ${rm} 分` : `${h} 小时`;
  }

  window.api = async function api(method, path) {
    const db = load();
    if (method === "GET" && path === "/api/commands/pending") return { items: db.items };
    let m = path.match(/^\/api\/commands\/(\d+)\/started$/);
    if (m && method === "POST") {
      const c = db.items.find((x) => x.id === +m[1]);
      if (c && !c.started_at) c.started_at = Date.now();
      save(db); return { ok: true, started_at: c?.started_at || Date.now() };
    }
    m = path.match(/^\/api\/commands\/(\d+)\/complete$/);
    if (m && method === "POST") {
      const c = db.items.find((x) => x.id === +m[1]);
      if (!c) return { error: "not found" };
      const dur = Date.now() - (c.started_at || c.created_at);
      db.feedback.push({ title: c.title, countdown_seconds: c.countdown_seconds, duration_ms: dur,
        duration_human: humanDuration(dur), vs_countdown: c.countdown_seconds ? dur - c.countdown_seconds * 1000 : null });
      db.items = db.items.filter((x) => x !== c);
      save(db); window.dispatchEvent(new Event("command-feedback"));
      return { ok: true, duration_ms: dur, duration_human: humanDuration(dur) };
    }
    m = path.match(/^\/api\/commands\/(\d+)$/);
    if (m && method === "DELETE") { db.items = db.items.filter((x) => x.id !== +m[1]); save(db); return { ok: true }; }
    throw new Error("mock api: unknown " + method + " " + path);
  };

  // 模拟 AI 回复里的 <countdown>{"title":"…","minutes":3}</countdown>
  window.mockPushCommand = (title, minutes) => {
    const db = load();
    db.items.push({ id: ++db.seq, title, countdown_seconds: minutes ? Math.round(minutes * 60) : null, created_at: Date.now(), started_at: null, created_by: "ai" });
    save(db);
  };

  // 与 server/feedback.js 的 consumeCommandFeedback 同一格式：这段文字会在用户下一条消息时注入给 AI
  window.mockConsumeFeedback = () => {
    const db = load();
    if (!db.feedback.length) return null;
    const lines = db.feedback.map((f) => {
      let line = `「${f.title}」用时 ${f.duration_human}`;
      if (f.countdown_seconds && f.vs_countdown !== null) {
        const v = f.vs_countdown;
        if (v < -5000) line += `（比预设 ${f.countdown_seconds}s 快 ${humanDuration(-v)}）`;
        else if (v > 5000) line += `（比预设 ${f.countdown_seconds}s 慢 ${humanDuration(v)}）`;
        else line += `（基本踩点 ${f.countdown_seconds}s）`;
      }
      return "- " + line;
    });
    db.feedback = []; save(db);
    return lines.join("\n");
  };
})();
