// 即时指令 · 服务端参考实现（Cloudflare Workers + D1，从 NEST 生产代码整理）
//
//   GET    /api/commands/pending        前端轮询，拿还没做完的指令
//   POST   /api/commands/:id/started    前端第一次显示时确认开始时间（= 指令推出时刻）
//   POST   /api/commands/:id/complete   左滑完成 → 记录用时，删掉指令
//   DELETE /api/commands/:id            长按取消 → 直接删掉（不通知 AI）
//
// AI 下指令：在回复正文里写 <countdown>{"title":"去喝水","minutes":1}</countdown>
//   不带 minutes = 不计时。保存回复时 extractCountdowns + createCommands 落库。
// AI 知道结果：用户下一条消息进模型前，consumeCommandFeedback 返回的文字拼进本轮上下文
//   （只放在每轮会变的尾部，不要放进提示词缓存段）。

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } });

export async function handleCommands(request, env) {
  const { pathname } = new URL(request.url);
  const method = request.method;
  if (pathname === "/api/commands/pending" && method === "GET") {
    const { results } = await env.DB.prepare(
      `SELECT id, title, countdown_seconds, created_at, started_at, created_by FROM commands ORDER BY created_at ASC`
    ).all();
    return json({ items: results || [] });
  }
  let m = pathname.match(/^\/api\/commands\/(\d+)\/started$/);
  if (m && method === "POST") return startCommand(env, +m[1]);
  m = pathname.match(/^\/api\/commands\/(\d+)\/complete$/);
  if (m && method === "POST") return completeCommand(env, +m[1]);
  m = pathname.match(/^\/api\/commands\/(\d+)$/);
  if (m && method === "DELETE") {
    await env.DB.prepare(`DELETE FROM commands WHERE id = ?`).bind(+m[1]).run();
    return json({ ok: true });
  }
  return null; // 不是指令路由
}

async function startCommand(env, id) {
  // 倒计时从 AI 推出指令的那一刻算（created_at），而不是用户切回来看到的时刻：
  // 用户不在前台时也在走，回来看到的就是真实剩余 / 已超时。
  const t = Date.now();
  await env.DB.prepare(`UPDATE commands SET started_at = COALESCE(created_at, ?) WHERE id = ? AND started_at IS NULL`).bind(t, id).run();
  const row = await env.DB.prepare(`SELECT started_at FROM commands WHERE id = ?`).bind(id).first();
  if (!row) return json({ error: "not found" }, 404);
  return json({ ok: true, started_at: row.started_at || t });
}

async function completeCommand(env, id) {
  const row = await env.DB.prepare(
    `SELECT title, countdown_seconds, created_at, started_at FROM commands WHERE id = ?`
  ).bind(id).first();
  if (!row) return json({ error: "not found" }, 404);
  const t = Date.now();
  const durationMs = t - (row.started_at || row.created_at);
  const cur = await env.DB.prepare(`SELECT v FROM settings WHERE k = 'pending_command_feedback'`).first();
  let arr = [];
  try { arr = cur?.v ? JSON.parse(cur.v) : []; } catch {}
  arr.push({
    title: row.title,
    countdown_seconds: row.countdown_seconds,
    duration_ms: durationMs,
    duration_human: humanDuration(durationMs),
    vs_countdown: row.countdown_seconds ? durationMs - row.countdown_seconds * 1000 : null,
    completed_at: t,
  });
  await env.DB.prepare(`INSERT OR REPLACE INTO settings (k, v) VALUES ('pending_command_feedback', ?)`)
    .bind(JSON.stringify(arr)).run();
  await env.DB.prepare(`DELETE FROM commands WHERE id = ?`).bind(id).run();
  return json({ ok: true, duration_ms: durationMs, duration_human: humanDuration(durationMs) });
}

export function humanDuration(ms) {
  const s = Math.round(ms / 1000);
  if (s < 60) return s + " 秒";
  const m = Math.floor(s / 60), rs = s % 60;
  if (m < 60) return rs ? `${m} 分 ${rs} 秒` : `${m} 分`;
  const h = Math.floor(m / 60), rm = m % 60;
  return rm ? `${h} 小时 ${rm} 分` : `${h} 小时`;
}

// 取出累积的完成反馈（消费后清空）。返回例：
//   - 「把被子叠好，拍照」用时 4 分 6 秒（比预设 180s 慢 1 分 6 秒）
export async function consumeCommandFeedback(env) {
  const cur = await env.DB.prepare(`SELECT v FROM settings WHERE k = 'pending_command_feedback'`).first();
  if (!cur?.v) return null;
  let arr; try { arr = JSON.parse(cur.v); } catch { return null; }
  if (!arr.length) return null;
  await env.DB.prepare(`DELETE FROM settings WHERE k = 'pending_command_feedback'`).run();
  return arr.map((f) => {
    let line = `「${f.title}」用时 ${f.duration_human}`;
    if (f.countdown_seconds && f.vs_countdown !== null) {
      const v = f.vs_countdown;
      if (v < -5000) line += `（比预设 ${f.countdown_seconds}s 快 ${humanDuration(-v)}）`;
      else if (v > 5000) line += `（比预设 ${f.countdown_seconds}s 慢 ${humanDuration(v)}）`;
      else line += `（基本踩点 ${f.countdown_seconds}s）`;
    }
    return "- " + line;
  }).join("\n");
}

// 从 AI 回复里解析 <countdown>…</countdown>，宽容处理模型写坏的 JSON
export function extractCountdowns(body) {
  if (!body || !body.includes("<countdown")) return [];
  const items = [];
  const re = /<countdown\b[^>]*>([\s\S]*?)<\/countdown>/gi;
  let m;
  while ((m = re.exec(body)) !== null) {
    const raw = m[1].trim();
    let o = null;
    try { o = JSON.parse(raw); } catch {}
    if (!o) {
      const title = raw.match(/"title"\s*:\s*"([\s\S]*?)"/)?.[1] || (raw.startsWith("{") ? null : raw);
      const mins = raw.match(/"minutes"\s*:\s*(\d+(?:\.\d+)?)/)?.[1];
      o = title ? { title, minutes: mins ? Number(mins) : null } : null;
    }
    if (!o || !String(o.title || "").trim()) continue;
    let cd = null;
    if (o.countdown_seconds != null) cd = parseInt(o.countdown_seconds);
    else if (o.minutes != null) cd = Math.round(Number(o.minutes) * 60);
    if (!Number.isFinite(cd) || cd < 0) cd = null;
    if (cd != null && cd > 86400) cd = 86400; // 上限 24h
    items.push({ title: String(o.title).trim(), countdown_seconds: cd });
  }
  return items;
}

// notify（可选）：新指令落库后调用 notify(env, cmd)，用来在用户不在前台时发推送
//   （Web Push、Bark、APNs……按你的 App 来）。计时已经开始，不通知用户就不知道。
export async function createCommands(env, items, notify) {
  const out = [];
  for (const it of items) {
    const t = Date.now();
    // 2 分钟内同名不重复建（流式断线重试会让模型把同一条再写一遍）
    const dup = await env.DB.prepare(`SELECT id FROM commands WHERE title = ? AND created_at >= ? LIMIT 1`)
      .bind(it.title, t - 120_000).first();
    if (dup) { out.push({ id: dup.id, ...it }); continue; }
    const r = await env.DB.prepare(
      `INSERT INTO commands (title, countdown_seconds, created_at, created_by) VALUES (?, ?, ?, 'ai')`
    ).bind(it.title, it.countdown_seconds, t).run();
    const cmd = { id: r.meta.last_row_id, ...it, created_at: t };
    if (notify) {
      try { await notify(env, cmd); } catch (e) { console.error("command notify err:", e.message); }
    }
    out.push(cmd);
  }
  return out;
}
