// ── 即时指令：边缘药丸(收起) + 大卡片(展开) ──
// 设计：磨砂玻璃药丸吸右缘，竖向可拖；轻点展开大卡片；
//   长按 ~620ms（描边充满）= 取消（DELETE）；左滑 >64px = 完成（POST /complete）；
//   单击切换 edge ↔ card；竖向拖动 = 沿右缘上下移动并吸附。
// 后端 API 不变：GET /api/commands/pending · POST /api/commands/:id/started ·
//   POST /api/commands/:id/complete · DELETE /api/commands/:id
const COMMAND_POLL_MS = 15000;
const CMD_POS_KEY = "cmd-edge-y";
const HOLD_MS = 620;
const SWIPE_DONE_PX = 64;
let CURRENT_COMMAND = null;
let commandPollTimer = null;
let commandTickTimer = null;
let commandOverFired = false;
let cmdMode = "edge"; // edge | card

// ── 即时指令 · 灵动岛 Live Activity 桥 ──
// 指令开始就上岛（不挑前后台）：你在 app 内时系统隐藏自身岛,放下手机去做事时岛上盯着倒计时。
// 指令署名复用当前角色配置，与发票清单上的名字一致。
function hasCommandBridge() {
  return !!(window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers.commandActivity);
}
function postCommandActivity(payload) {
  if (!hasCommandBridge()) return;
  try { window.webkit.messageHandlers.commandActivity.postMessage(payload); } catch (e) {}
}

function loadEdgeY() {
  try {
    const v = parseFloat(localStorage.getItem(CMD_POS_KEY));
    if (!isNaN(v)) return v;
  } catch {}
  return Math.max(90, Math.min(window.innerHeight * 0.18, 160));
}
function saveEdgeY(y) {
  try { localStorage.setItem(CMD_POS_KEY, String(y)); } catch {}
}
function clampY(y, h) {
  const minY = 70;
  const maxY = window.innerHeight - h - 110; // 避开 composer / 键盘
  return Math.max(minY, Math.min(maxY, y));
}
function applyEdgeY(y) {
  const edge = $("cmd-edge");
  const h = edge.offsetHeight || 60;
  const cy = clampY(y, h);
  edge.style.top = cy + "px";
  const dr = $("cmd-done-reveal");
  dr.style.top = (cy + h / 2 - 15) + "px";
}
function applyCardY(y) {
  const card = $("cmd-card");
  const h = card.offsetHeight || 180;
  card.style.top = clampY(y, h) + "px";
}

function showEdge() {
  cmdMode = "edge";
  $("cmd-edge").classList.add("show");
  $("cmd-card").classList.remove("show");
  // 等待 display:flex 应用后再 clamp
  requestAnimationFrame(() => applyEdgeY(loadEdgeY()));
}
function showCard() {
  cmdMode = "card";
  $("cmd-card").classList.add("show");
  $("cmd-edge").classList.remove("show");
  requestAnimationFrame(() => applyCardY(loadEdgeY()));
}
function hideAll() {
  ["cmd-edge", "cmd-card", "cmd-done-reveal"].forEach((id) => {
    const el = $(id);
    el.classList.remove("show", "over", "dragging");
    el.style.transform = "";
    el.style.setProperty("--cmd-hold-pct", 0);
  });
  $("cmd-card-hint-swipe")?.classList.remove("swipe-active");
}

async function pollCommands() {
  if (CURRENT_COMMAND) return;
  try {
    const r = await api("GET", "/api/commands/pending");
    if (!r.items || !r.items.length) return;
    showCommand(r.items[0]);
  } catch (e) { /* 静默 */ }
}
function startCommandPolling() {
  if (commandPollTimer) return;
  pollCommands();
  commandPollTimer = setInterval(pollCommands, COMMAND_POLL_MS);
}
function stopCommandPolling() {
  if (commandPollTimer) { clearInterval(commandPollTimer); commandPollTimer = null; }
}
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") startCommandPolling();
  else stopCommandPolling();
});

async function showCommand(cmd) {
  CURRENT_COMMAND = cmd;
  commandOverFired = false;
  if (!cmd.started_at) {
    try {
      const r = await api("POST", "/api/commands/" + cmd.id + "/started");
      cmd.started_at = r.started_at;
    } catch (e) { cmd.started_at = cmd.created_at || Date.now(); } // 计时从指令推出时刻算
  }
  $("cmd-card-text").textContent = cmd.title || "";
  // "起"：started_at 的 HH:MM
  const fromMs = cmd.started_at || cmd.created_at || Date.now();
  const d = new Date(fromMs);
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  $("cmd-card-from").textContent = `${hh}:${mm} 起`;
  $("cmd-edge").classList.remove("over");
  $("cmd-card").classList.remove("over");
  updateCommandTime();
  showEdge();
  if (commandTickTimer) clearInterval(commandTickTimer);
  commandTickTimer = setInterval(updateCommandTime, 500);
  if (navigator.vibrate) try { navigator.vibrate(15); } catch {}
  // 上岛：倒计时 / 计时上行都行（countdown_seconds 空 = 上行）
  postCommandActivity({
    type: "start",
    commandId: cmd.id,
    title: cmd.title || "",
    startedAtMs: cmd.started_at || cmd.created_at || Date.now(),
    countdownSeconds: cmd.countdown_seconds || 0,
    issuedBy: window.COMMAND_ISSUER || "AI",
  });
}

function fmtCmd(s) {
  s = Math.max(0, Math.round(s));
  const m = Math.floor(s / 60), ss = s % 60;
  return `${String(m).padStart(2, "0")}:${String(ss).padStart(2, "0")}`;
}
function fmtCmdHMS(s) {
  s = Math.max(0, Math.round(s));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = s % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(ss).padStart(2, "0")}`;
  return fmtCmd(s);
}
function fmtCmdOver(s) {
  s = Math.round(s);
  const m = Math.floor(s / 60), ss = s % 60;
  return m > 0 ? `+${m}:${String(ss).padStart(2, "0")}` : `+${ss}″`;
}

function updateCommandTime() {
  const cmd = CURRENT_COMMAND;
  if (!cmd) return;
  const edge = $("cmd-edge");
  const card = $("cmd-card");
  const elapsedMs = Date.now() - (cmd.started_at || cmd.created_at);
  const hasCountdown = !!cmd.countdown_seconds;

  let pct = 0, remainingS = 0, over = 0;
  if (hasCountdown) {
    const totalS = cmd.countdown_seconds;
    remainingS = totalS - Math.floor(elapsedMs / 1000);
    if (remainingS > 0) {
      pct = Math.min(1, (totalS - remainingS) / totalS);
    } else {
      pct = 1;
      over = -remainingS;
    }
  } else {
    remainingS = Math.floor(elapsedMs / 1000); // 流逝时间
    pct = 0;
  }

  let edgeText, cardTimeText, statusText;
  if (hasCountdown) {
    if (over > 0) {
      edgeText = over < 60 ? `+${over}` : fmtCmdOver(over);
      cardTimeText = fmtCmdOver(over);
      statusText = "已超时";
    } else {
      edgeText = fmtCmd(remainingS);
      cardTimeText = fmtCmd(remainingS);
      statusText = "还剩";
    }
  } else {
    edgeText = fmtCmd(remainingS);
    cardTimeText = fmtCmdHMS(remainingS);
    statusText = "已过";
  }

  $("cmd-edge-time").textContent = edgeText;
  $("cmd-card-time").textContent = cardTimeText;
  $("cmd-card-status").textContent = statusText;

  // 进度环 (svg stroke-dashoffset, r=7.4, C≈46.5)
  const C = 2 * Math.PI * 7.4;
  $("cmd-edge-ring-fg").setAttribute("stroke-dashoffset", String(C * (1 - pct)));
  $("cmd-edge-prog").style.height = `${pct * 100}%`;
  $("cmd-card-bar").style.width = `${pct * 100}%`;

  if (over > 0 && !commandOverFired) {
    commandOverFired = true;
    edge.classList.add("over");
    card.classList.add("over");
    if (navigator.vibrate) try { navigator.vibrate([120, 60, 120]); } catch {}
  }
}

function showResult(kind, text) {
  const r = $("cmd-result");
  r.classList.remove("done", "cancel");
  r.classList.add(kind);
  const icon = $("cmd-result-icon");
  if (kind === "done") {
    icon.innerHTML = '<svg width="13" height="13" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 10.5l4 4 8-9"/></svg>';
  } else {
    icon.innerHTML = '<svg width="12" height="12" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"><path d="M5 5l10 10M15 5L5 15"/></svg>';
  }
  $("cmd-result-text").textContent = text;
  const y = loadEdgeY();
  r.style.top = (y + 6) + "px";
  r.classList.add("show");
  setTimeout(() => r.classList.remove("show"), 1700);
}

async function completeCurrentCommand() {
  const cmd = CURRENT_COMMAND;
  if (!cmd) return;
  CURRENT_COMMAND = null;
  if (commandTickTimer) { clearInterval(commandTickTimer); commandTickTimer = null; }
  if (navigator.vibrate) try { navigator.vibrate(20); } catch {}
  hideAll();
  // 完成胶囊带上用时；有倒计时且超了就显示超时多久
  const usedS = Math.max(0, Math.floor((Date.now() - (cmd.started_at || cmd.created_at || Date.now())) / 1000));
  const mmss = n => String(Math.floor(n / 60)).padStart(2, "0") + ":" + String(n % 60).padStart(2, "0");
  const overS = cmd.countdown_seconds ? usedS - cmd.countdown_seconds : 0;
  showResult("done", overS > 0 ? "完成 · 超时 " + mmss(overS) : "完成 · 用时 " + mmss(usedS));
  postCommandActivity({ type: "end", commandId: cmd.id }); // app 内已弹"已完成"反馈,岛立刻撤,不留 6s 残留
  try { await api("POST", "/api/commands/" + cmd.id + "/complete"); } catch (e) {}
  setTimeout(pollCommands, 1800);
}

async function cancelCurrentCommand() {
  const cmd = CURRENT_COMMAND;
  if (!cmd) return;
  CURRENT_COMMAND = null;
  if (commandTickTimer) { clearInterval(commandTickTimer); commandTickTimer = null; }
  if (navigator.vibrate) try { navigator.vibrate([60, 30, 60]); } catch {}
  hideAll();
  showResult("cancel", "已取消");
  postCommandActivity({ type: "end", commandId: cmd.id }); // 取消 → 撤岛
  try { await api("DELETE", "/api/commands/" + cmd.id); } catch (e) {}
  setTimeout(pollCommands, 1800);
}

// 通用手势 (edge / card 共用)
function setupCmdGesture(el, kind) {
  let st = null, holdRaf = 0;
  function cancelHold() {
    if (holdRaf) { cancelAnimationFrame(holdRaf); holdRaf = 0; }
    el.style.setProperty("--cmd-hold-pct", 0);
  }
  function startHold() {
    const t0 = performance.now();
    const step = (t) => {
      if (!st) { cancelHold(); return; }
      const p = Math.min(1, (t - t0) / HOLD_MS);
      el.style.setProperty("--cmd-hold-pct", p);
      if (p >= 1) { cancelCurrentCommand(); cancelHold(); st = null; return; }
      holdRaf = requestAnimationFrame(step);
    };
    holdRaf = requestAnimationFrame(step);
  }

  function onDown(x, y, ev) {
    if (!CURRENT_COMMAND) return;
    st = {
      x0: x, y0: y, t0: performance.now(),
      top0: parseFloat(el.style.top) || 0,
      axis: null, moved: false, dx: 0, dy: 0,
    };
    el.classList.add("dragging");
    startHold();
    if (ev && ev.cancelable) ev.preventDefault();
  }
  function onMove(x, y) {
    if (!st) return;
    const dx = x - st.x0, dy = y - st.y0;
    st.dx = dx; st.dy = dy;
    if (!st.axis && Math.hypot(dx, dy) > 7) {
      st.axis = Math.abs(dx) > Math.abs(dy) ? "x" : "y";
      st.moved = true;
      cancelHold();
    }
    if (st.axis === "y") {
      const newY = clampY(st.top0 + dy, el.offsetHeight);
      el.style.top = newY + "px";
      if (kind === "edge") {
        const dr = $("cmd-done-reveal");
        dr.style.top = (newY + el.offsetHeight / 2 - 15) + "px";
      }
    } else if (st.axis === "x") {
      const tx = dx < 0 ? Math.max(dx, -96) : dx * 0.18;
      el.style.transform = `translateX(${tx}px)`;
      const swipePct = Math.min(1, -Math.min(0, dx) / SWIPE_DONE_PX);
      if (kind === "edge") {
        const dr = $("cmd-done-reveal");
        dr.classList.add("show");
        dr.style.opacity = String(swipePct);
      } else {
        const hint = $("cmd-card-hint-swipe");
        if (swipePct > 0.4) hint.classList.add("swipe-active");
        else hint.classList.remove("swipe-active");
      }
    }
  }
  function onUp() {
    if (!st) return;
    el.classList.remove("dragging");
    const s = st; st = null;
    cancelHold();
    const dt = performance.now() - s.t0;
    if (s.axis === "x") {
      if (s.dx <= -SWIPE_DONE_PX) {
        completeCurrentCommand();
        return;
      }
      el.style.transform = "";
      const dr = $("cmd-done-reveal");
      dr.style.opacity = "0";
      dr.classList.remove("show");
      $("cmd-card-hint-swipe")?.classList.remove("swipe-active");
    } else if (s.axis === "y") {
      const newY = parseFloat(el.style.top) || 0;
      saveEdgeY(newY);
    } else if (!s.moved && dt < 350) {
      if (kind === "edge") showCard();
      else showEdge();
    }
  }

  el.addEventListener("touchstart", (ev) => onDown(ev.touches[0].clientX, ev.touches[0].clientY, ev), { passive: false });
  el.addEventListener("touchmove", (ev) => {
    onMove(ev.touches[0].clientX, ev.touches[0].clientY);
    if (st && st.axis === "x" && ev.cancelable) ev.preventDefault();
  }, { passive: false });
  el.addEventListener("touchend", onUp);
  el.addEventListener("touchcancel", onUp);
  el.addEventListener("mousedown", (ev) => {
    onDown(ev.clientX, ev.clientY, ev);
    const mm = (e) => onMove(e.clientX, e.clientY);
    const mu = () => {
      document.removeEventListener("mousemove", mm);
      document.removeEventListener("mouseup", mu);
      onUp();
    };
    document.addEventListener("mousemove", mm);
    document.addEventListener("mouseup", mu);
  });
}

setupCmdGesture($("cmd-edge"), "edge");
setupCmdGesture($("cmd-card"), "card");

// 关闭按钮：直接收起到药丸
$("cmd-card-close")?.addEventListener("click", (ev) => {
  ev.stopPropagation();
  showEdge();
});

// 视口变化时重新 clamp
window.addEventListener("resize", () => {
  if (!CURRENT_COMMAND) return;
  if (cmdMode === "edge") applyEdgeY(loadEdgeY());
  else applyCardY(loadEdgeY());
});

// 启动轮询
if (document.visibilityState === "visible") startCommandPolling();
