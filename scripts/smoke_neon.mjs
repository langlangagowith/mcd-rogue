// 麦门幸存者 · 无头冒烟测试
// 桩掉 DOM（getElementById 返回 null ⇒ boot() 立刻退出），只驱动纯模拟 update()。
// 验证：数据注入 / 确定性 / 接触伤害 / 走位收益 / 升级选卡 / 通关判定 / 长跑不变量。
//
// 用法：node scripts/smoke_neon.mjs
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const HTML = path.join(ROOT, "docs", "neon.html");

let pass = 0, fail = 0;
const ok = (cond, msg) => { if (cond) { pass++; console.log(`  ✓ ${msg}`); } else { fail++; console.log(`  ✗ ${msg}`); } };

/* ---------- 1) 抽出主脚本并加载（DOM 全桩） ---------- */
const html = fs.readFileSync(HTML, "utf8");
const blocks = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
const js = blocks.find((s) => s.includes("McSurvivor"));
if (!js) { console.error("✗ 找不到主脚本"); process.exit(1); }

const ctx = vm.createContext({ document: { getElementById: () => null }, console });
vm.runInContext(js, ctx, { filename: "neon.html" });
const T = ctx.McSurvivor;
ok(!!T, "脚本加载后导出 McSurvivor 接口");
if (!T) process.exit(1);

const DT = 1 / 60;
const snap = () => T.snapshot();

/* ---------- 走位机器人：贴身就跑，安全就捡经验 ---------- */
function botStep(st, i) {
  const P = st.player;
  if (i % 4 !== 0) return;                        // 每 4 帧决策一次
  let near = null, nd = Infinity;
  for (const e of st.enemies) { const d = (e.x - P.x) ** 2 + (e.y - P.y) ** 2; if (d < nd) { nd = d; near = e; } }
  let tx = null, ty = null;
  if (near && nd < 130 * 130) {                   // 贴身：反向拉开
    const dx = P.x - near.x, dy = P.y - near.y, m = Math.hypot(dx, dy) || 1;
    tx = P.x + (dx / m) * 240; ty = P.y + (dy / m) * 240;
  } else {                                        // 安全：去捡经验
    let g = null, gd = Infinity;
    for (const gg of st.gems) { const d = (gg.x - P.x) ** 2 + (gg.y - P.y) ** 2; if (d < gd) { gd = d; g = gg; } }
    if (g) { tx = g.x; ty = g.y; }
  }
  if (tx !== null) { T.pointer.active = true; T.pointer.x = tx; T.pointer.y = ty; }
}
function botRun(seed, seconds, picker) {
  T.reset(seed, { autoStart: true });
  const steps = Math.round(seconds / DT);
  for (let i = 0; i < steps; i++) {
    const st = T.state();
    botStep(st, i);
    T.update(DT);
    if (st.levelup) T.choose(picker ? picker(st.levelup.cards, i) : 0);
    if (st.over) break;
  }
  T.pointer.active = false;
  return snap();
}

console.log("\n1) 真实营养数据注入");
ok(T.ARCH.length >= 40, `敌人原型来自真实菜单：${T.ARCH.length} 种`);
{
  const byHp = T.ARCH.slice().sort((a, b) => b.hp - a.hp)[0];
  ok(byHp.kcal === Math.max(...T.ARCH.map((a) => a.kcal)), `最肉原型 = 热量最高餐品（${byHp.name} ${byHp.kcal}kcal）`);
  ok(/[\u4e00-\u9fff]/.test(byHp.name), "原型名是真实中文餐品名，不是占位符");
  const asc = T.ARCH.slice().sort((a, b) => a.kcal - b.kcal);
  let mono = true;
  for (let i = 1; i < asc.length; i++) if (asc[i].hp < asc[i - 1].hp) mono = false;
  ok(mono, "热量↑ ⇒ 血量↑ 单调成立（数值确由营养数据派生）");
  ok(asc[0].speed > asc[asc.length - 1].speed, "热量↑ ⇒ 速度↓（顶饱的更慢）");
}

console.log("\n2) 确定性（同种子同结果）");
const runPlain = (seed, sec) => { T.reset(seed, { autoStart: true }); T.run(sec, DT); return JSON.stringify(snap()); };
const a1 = runPlain(20261009, 60), a2 = runPlain(20261009, 60), c1 = runPlain(777, 60);
ok(a1 === a2, "同种子 60s 逐字段一致");
ok(a1 !== c1, "换种子结果不同（随机确实起作用）");

console.log("\n3) 站桩：接触伤害生效 + 自动开火有输出");
T.reset(20261009, { autoStart: true });
const r3 = T.run(300, DT);
const s3 = snap();
ok(s3.kills > 0, `站桩也能靠自动开火造成击杀：${s3.kills} 只`);
ok(s3.over === true, "站桩最终被围死（接触伤害生效）");
ok(s3.time > 5 && s3.time < 300, `死亡时间 ${s3.time.toFixed(1)}s 落在 (5, 300) 内`);
ok(s3.hp === 0, "死亡时 hp 恰为 0，不为负");

console.log("\n4) 走位机器人：走位才有收益");
const preferWeapon = (cards) => { const i = cards.findIndex((c) => c.type === "weapon"); return i >= 0 ? i : 0; };
const s4 = botRun(20261009, 300, preferWeapon);
console.log(`     站桩存活 ${s3.time.toFixed(1)}s / 击杀 ${s3.kills} ｜ 走位存活 ${s4.time.toFixed(1)}s / 击杀 ${s4.kills} / Lv.${s4.level}`);
ok(s4.time > s3.time, `走位活得比站桩久（${s4.time.toFixed(1)}s > ${s3.time.toFixed(1)}s）`);
// 击杀数不再是好口径：站桩那局靠「麦门爆发」白捡十几杀会污染对比 —— 改用生存线
ok(s3.time < 60 && s4.time > 60, `站桩活不过 60s（${s3.time.toFixed(1)}s）而走位能（${s4.time.toFixed(1)}s）`);
ok(s4.level >= 3, `走位能构筑起来：Lv.${s4.level}`);
ok(s4.weapons.length >= 2, `已凑出多把武器：${s4.weapons.join(", ")}`);

console.log("\n5) 通关判定（撑满 5 分钟）");
T.reset(1, { autoStart: true });
T.state().time = 299.98;                       // update 会把 dt clamp 到 0.05，故留够余量
T.update(0.05);
const s5 = snap();
ok(s5.over === true && s5.won === true, `time 达 300s ⇒ 判通关（实测 ${s5.time.toFixed(2)}s）`);

console.log("\n6) 升级三选一：卡池合法 + 越界安全");
T.reset(20261009, { autoStart: true });
{
  let hit = false;
  for (let i = 0; i < 60 * 120 && !T.state().over; i++) {   // 用机器人直跑到第一次升级
    botStep(T.state(), i);
    T.update(DT);
    if (T.state().levelup) { hit = true; break; }
  }
  T.pointer.active = false;
  ok(hit, "走位后能进入升级选卡界面");
  const cards = hit ? T.state().levelup.cards : null;
  if (cards) {
    ok(cards.length >= 1 && cards.length <= 3, `同时给出 ${cards.length} 张（1~3）`);
    const ks = cards.map((c) => `${c.type}:${c.id}`);
    ok(new Set(ks).size === ks.length, "三张卡互不重复");
    ok(cards.every((c) => c.name && c.icon && c.desc), "每张卡都有 名称/图标/描述");
    ok(cards.every((c) => (c.type === "weapon" ? !!T.WEAPONS[c.id] : !!T.PASSIVES[c.id])), "卡都指向真实武器/被动");
    ok(T.choose(9) === false, "越界索引被拒绝");
    ok(!!T.state().levelup, "越界后仍停在选卡界面（没被误清）");
    ok(T.choose(0) === true, "合法索引选择成功");
    ok(!T.state().levelup, "选择后关闭选卡界面");
  }
}

console.log("\n7) 长跑不变量（走位跑满 2 分钟）");
T.reset(424242, { autoStart: true });
let maxE = 0, hpOk = true, posOk = true, prevT = 0, timeMono = true;
for (let i = 0; i < Math.round(120 / DT); i++) {
  const st = T.state();
  botStep(st, i);
  T.update(DT);
  if (st.levelup) T.choose(i % 3);
  maxE = Math.max(maxE, st.enemies.length);
  if (st.player.hp < 0) hpOk = false;
  if (!Number.isFinite(st.player.x) || !Number.isFinite(st.player.y)) posOk = false;
  if (st.time < prevT) timeMono = false;
  prevT = st.time;
  if (st.over) break;
}
T.pointer.active = false;
{
  const s7 = snap();
  ok(hpOk, "血量从不为负");
  ok(posOk, "坐标始终有限（无 NaN 穿透）");
  ok(timeMono, "时间单调不减");
  ok(maxE <= 280, `敌人数不超上限：峰值 ${maxE} ≤ 280`);
  ok(Number.isFinite(s7.time) && s7.time > 0, `时间推进正常：${s7.time.toFixed(1)}s`);
  ok(s7.over || s7.time >= 119, `长跑要么已结束、要么跑满：${s7.time.toFixed(1)}s`);
}

// 元素可能压根没被创建（例如遮罩从未被 show）⇒ 不存在即视为"没打开"，不能让它崩
const hasOn = (b, id) => { const el = b.els.get(id); return !!(el && el.classList.contains("on")); };

/* ---------- 可复用的「完整 DOM 桩」工厂 ---------- */
// 严格桩：只认真实的 canvas 2D 成员；打错方法名会真抛 TypeError（宽松 Proxy 会把错别字吞成空函数）。
const CTX_METHODS = ["arc", "arcTo", "beginPath", "closePath", "fill", "fillRect", "fillText",
  "lineTo", "moveTo", "restore", "rotate", "save", "setTransform", "stroke", "translate"];
function makeBootCtx(winExtra, opts) {
  const ctxStub = { measureText: () => ({ width: 10 }) };
  for (const m of CTX_METHODS) ctxStub[m] = () => {};
  ctxStub._draws = 0;
  ctxStub.drawImage = () => { ctxStub._draws++; };       // 立绘渲染路径计数
  const els = new Map();
  const mkEl = (id) => {
    if (els.has(id)) return els.get(id);
    const el = {
      id, style: {}, innerHTML: "", textContent: "", onclick: null,
      clientWidth: 800, clientHeight: 600, width: 0, height: 0, type: "", className: "",
      _h: {},
      classList: {
        _s: new Set(),
        add(c) { this._s.add(c); }, remove(c) { this._s.delete(c); },
        contains(c) { return this._s.has(c); }
      },
      getContext: () => ctxStub,
      getBoundingClientRect: () => ({ left: 0, top: 0, width: 800, height: 600 }),
      appendChild: () => {},
      addEventListener(t, fn) { (el._h[t] = el._h[t] || []).push(fn); },
      querySelectorAll: () => []
    };
    els.set(id, el);
    return el;
  };
  const win = Object.assign({
    _h: {},
    addEventListener(t, fn) { (this._h[t] = this._h[t] || []).push(fn); },
    devicePixelRatio: 1, innerWidth: 800, innerHeight: 600,
    matchMedia: () => ({ matches: false })
  }, winExtra || {});
  // 立绘 Image 桩：赋 src 同步触发 onload ⇒ 测试里立绘立即就绪，渲染真走 drawImage 路径
  function FakeImg() {
    this.onload = null; this.onerror = null;
    this.width = 256; this.height = 256; this.naturalWidth = 256; this.naturalHeight = 256;
    const self = this;
    Object.defineProperty(this, "src", {
      get() { return self._src || ""; },
      set(v) { self._src = v; if (v && self.onload) self.onload(); }
    });
  }
  const sandbox = {
    console, URLSearchParams,
    document: { getElementById: mkEl, createElement: () => mkEl("__new__" + els.size), addEventListener: () => {} },
    location: { search: (opts && opts.search) || "", href: "" },
    requestAnimationFrame: () => 0,
    window: win
  };
  if (!(opts && opts.noImage)) sandbox.Image = FakeImg;   // 负向控制：noImage 模拟老内核（无 Image ⇒ 回退色块）
  const ctx = vm.createContext(sandbox);
  let err = null;
  try { vm.runInContext(js, ctx, { filename: "neon.html(boot)" }); } catch (e) { err = e; }
  return { T: ctx.McSurvivor, els, win, err, ctx: ctxStub };
}

console.log("\n8) 启动装配与渲染路径（完整 DOM 桩，补上渲染盲区）");
{
  const b = makeBootCtx();                        // 无 PointerEvent ⇒ 走 touch 回退分支
  ok(!b.err, b.err ? `boot() 抛异常：${b.err.message}` : "boot() 在完整 DOM 桩下装配成功（含首次 render）");
  ok(!!b.T && typeof b.T.render === "function", "同时导出 render，可独立驱动渲染");

  let boom = null;
  try {
    b.T.reset(20261009, { autoStart: true });
    for (let i = 0; i < 60 * 20; i++) { b.T.update(DT); if (b.T.state().levelup) b.T.choose(0); b.T.render(); }
    b.T.state().levelup = { cards: [{ type: "weapon", id: "cola", lvl: 1, name: "x", icon: "1", desc: "d" }], at: 2 };
    b.T.render();
  } catch (e) { boom = e; }
  ok(!boom, boom ? `渲染/推进抛异常：${boom.message}` : "连续 20s 推进 + 逐帧 render 无异常");
}

console.log("\n9) 移动端回归：进得去 + 点得开 + 有怪（对应线上反馈的 bug）");
{
  const b = makeBootCtx();                        // 无 PointerEvent：微信内置浏览器（X5）就是这种
  ok((b.win._h.touchstart || []).length === 1, "无 PointerEvent 时绑定了 touchstart 回退（否则手机上动不了）");
  ok((b.win._h.pointerdown || []).length === 0, "不会两套都绑、导致重复触发");
  ok(hasOn(b, "ovStart"), "开局遮罩 ovStart 已显示（不显示就无处可点 ⇒ 卡死）");

  const btn = b.els.get("btnStart");
  ok(!!btn && typeof btn.onclick === "function", "开始按钮已挂上点击处理");
  if (btn && btn.onclick) btn.onclick();           // 模拟点「开饭」
  ok(b.T.state().started === true, "点「开饭」后进入 started");
  ok(!hasOn(b, "ovStart"), "开局后遮罩关闭");

  for (let i = 0; i < 60 * 6; i++) b.T.update(DT);
  const s = b.T.snapshot();
  ok(s.time > 5, `计时在走：${s.time.toFixed(1)}s`);
  ok(s.enemies > 0, `开局 6 秒后确实有怪：${s.enemies} 只（线上反馈正是"没有怪"）`);

  const st = b.T.state();
  const x0 = st.player.x;
  b.win._h.touchstart[0]({ touches: [{ clientX: 400, clientY: 300 }], cancelable: true });
  b.win._h.touchmove[0]({ touches: [{ clientX: 470, clientY: 300 }], cancelable: true, preventDefault: () => {} });  // 向右拖 70px ⇒ 满速
  for (let i = 0; i < 60; i++) b.T.update(DT);
  ok(st.player.x > x0 + 100, `触屏摇杆拖动后玩家向右移动：Δx=${(st.player.x - x0).toFixed(1)}px`);
  const x1 = st.player.x;
  b.win._h.touchend[0]({});
  for (let i = 0; i < 30; i++) b.T.update(DT);
  ok(Math.abs(st.player.x - x1) < 0.5, `松手即停（滑步 ${(st.player.x - x1).toFixed(2)}px）`);
  // 启动提示/错误可视（2026-10-09 "只有背景"反馈后的保障：加载中有提示、异常有红条）
  ok(!!b.els.get("bootTip") && b.els.get("bootTip").style.display === "none", "启动完成后加载提示已撤下");
}

console.log("\n10) 桌面路径（有 PointerEvent）");
{
  const b = makeBootCtx({ PointerEvent: function PointerEvent() {} });
  ok((b.win._h.pointerdown || []).length === 1, "有 PointerEvent 时走 pointer 分支");
  ok((b.win._h.touchstart || []).length === 0, "pointer 分支下不重复绑 touch");
  ok(hasOn(b, "ovStart"), "桌面同样能进开始遮罩");
}

console.log("\n11) 产物静态自检");
{
  ok(/<title>[^<]*麦门幸存者[^<]*<\/title>/.test(html), "标题含游戏名");
  ok(!html.includes("__NEON_DATA__"), "注入占位符已全部替换");
  const openTags = (html.match(/<script>/g) || []).length;
  const closeTags = (html.match(/<\/script>/g) || []).length;
  ok(openTags === closeTags && openTags > 0, `script 标签闭合（${openTags} 开 ${closeTags} 闭）`);
  ok(html.trimEnd().endsWith("</html>"), "文件结构完整收尾于 </html>");
  ok(/id="bootTip"/.test(html) && /id="bootErr"/.test(html),
    "加载提示与错误可视元素都在产物里（结构级保障：弱网/异常不再是“只有背景”）");
}

console.log("\n12) 每日挑战（与出餐口同一口径：种子 = 当日 YYYYMMDD）");
{
  const b = makeBootCtx();
  const tag = b.T.dayTagOf(new Date());
  ok(b.T.isDailySeed(20261010) === true && b.T.isDailySeed(999) === false, "YYYYMMDD 形状 ⇒ 每日挑战局");
  ok(tag.length === 8 && /^\d{8}$/.test(tag), `dayTagOf 产出 YYYYMMDD（${tag}）`);
  ok(b.T.daySeed() === (parseInt(tag, 10) >>> 0), `开局种子 = 今日日期（${b.T.daySeed()}）`);
  ok(makeBootCtx().T.daySeed() === b.T.daySeed(), "同一天两次打开 ⇒ 同一颗种子（全站同题）");
  ok(makeBootCtx(null, { search: "?d=20260101" }).T.daySeed() === 20260101, "?d=YYYYMMDD ⇒ 回玩那一天");
  ok((b.els.get("seedTag").textContent || "").includes("今日挑战"),
    `开始页标签写着今日挑战：${b.els.get("seedTag").textContent}`);
  b.els.get("btnSeed").onclick();
  ok(!(b.els.get("seedTag").textContent || "").includes("今日挑战"), "点「换种子」⇒ 退出每日挑战，回到随机种子");
  let casualDaily = 0;
  for (let i = 0; i < 2000; i++) if (b.T.isDailySeed(b.T.newSeed())) casualDaily++;
  ok(casualDaily === 0, `随机种子 2000 次采样无一落进每日区间（原实现约 1/441 把「换种子」误判成每日挑战，实测值 ${casualDaily}）`);
}

console.log("\n13) 触屏摇杆（跟手：幅度给速度 + 浮动原点 + 松手即停）");
{
  const b = makeBootCtx();
  b.T.reset(20261009, { autoStart: true });
  const S = b.T.state(), x0 = S.player.x;

  b.T.joyStart(200, 200);
  b.T.joyMove(210, 200);                       // 拖 10px：越过死区（7）⇒ 低速档
  ok(b.T.joy.active && b.T.joy.mag > 0 && b.T.joy.mag < 0.35, `轻推 ⇒ 低速档：mag=${b.T.joy.mag.toFixed(2)}`);
  for (let i = 0; i < 30; i++) b.T.update(DT);
  const slow = S.player.x - x0;
  ok(slow > 0, `轻推也走：Δx=${slow.toFixed(1)}px`);

  b.T.joyStart(200, 200); b.T.joyMove(260, 200);   // 拖 60px ≥ JOY_R(56) ⇒ 满速
  ok(b.T.joy.mag === 1, "推满 ⇒ 速度倍率 1.0");
  const x1 = S.player.x;
  for (let i = 0; i < 30; i++) b.T.update(DT);
  const fast = S.player.x - x1;
  ok(fast > slow * 1.8, `推满明显更快：${fast.toFixed(1)}px vs ${slow.toFixed(1)}px（幅度→速度）`);

  b.T.joyEnd();
  const x2 = S.player.x;
  for (let i = 0; i < 30; i++) b.T.update(DT);
  ok(Math.abs(S.player.x - x2) < 0.5, "松手即停（旧「朝点走」的滑步被消除）");
  ok(!b.T.joy.active && b.T.joy.mag === 0, "摇杆状态复位");

  b.T.joyStart(100, 100); b.T.joyMove(104, 100);   // 4px < 死区 7px
  ok(b.T.joy.mag === 0, "死区内不移动（手指微颤不走）");
  b.T.joyEnd();

  // 浮动原点：拖出半径后原点贴着手指走 ⇒ 方向跟随"手指实际移动"而不是"从最初按下点看的钝角"
  b.T.joyStart(100, 100);
  b.T.joyMove(400, 100);      // 拖到 300px 外 ⇒ 原点浮动到手指后方 56px 处
  ok(Math.abs(400 - b.T.joy.ox - 56) < 0.01, `浮动原点贴住半径边缘：|finger-ox|=${(400 - b.T.joy.ox).toFixed(1)}px`);
  b.T.joyMove(400, 160);      // 手指再下移 60px ⇒ 方向应明显偏下（固定原点算法下只会偏 11°）
  ok(b.T.joy.ny > 0.55, `拖出后的方向微调灵敏（跟手）：n=(${b.T.joy.nx.toFixed(2)}, ${b.T.joy.ny.toFixed(2)})`);
  b.T.joyEnd();
}

console.log("\n14) 子弹自动瞄准（最近目标 + 预判 + 追踪）");
{
  const b = makeBootCtx();
  b.T.reset(20261009, { autoStart: true });
  const S = b.T.state();
  const mkEnemy = (x, y, speed) => {
    const e = { x, y, r: 14, arch: b.T.ARCH[0], hp: 100, maxHp: 100, speed: speed || 0,
      dmg: 5, xp: 2, boss: false, hitCd: 0, flash: 0, wob: 0, dead: false };
    S.enemies.push(e);
    return e;
  };

  ok(b.T.aimAngle(S, 0, 0, 520) === null, "场上无敌人 ⇒ aimAngle 返回 null（交由武器回退到面向）");

  mkEnemy(300, 0, 0);
  ok(Math.abs(b.T.aimAngle(S, 0, 0, 520)) < 0.02, "正右敌人 ⇒ 瞄准角 ≈ 0");
  S.enemies.length = 0;

  mkEnemy(0, -300, 0);
  ok(Math.abs(b.T.aimAngle(S, 0, 0, 520) + Math.PI / 2) < 0.02, "正上敌人 ⇒ 瞄准角 ≈ -π/2");
  S.enemies.length = 0;

  mkEnemy(0, -500, 0); mkEnemy(200, 0, 0);   // 一远一近
  ok(Math.abs(b.T.aimAngle(S, 0, 0, 520)) < 0.02, "多敌人 ⇒ 瞄最近的（200px 那个）");
  S.enemies.length = 0;

  // 集成：开火方向真的朝敌 + 追踪标记
  mkEnemy(300, 0, 0);
  S.weapons = [{ id: "ketchup", lvl: 1, timer: 0, orbit: 0 }];
  S.bullets.length = 0;
  b.T.update(DT);
  const bb = S.bullets[0];
  ok(!!bb && Math.abs(bb.ang) < 0.05, `番茄弹朝最近敌人发射（ang=${bb ? bb.ang.toFixed(3) : "无"}）`);
  ok(!!bb && bb.homing > 0, "番茄弹带轻微追踪（发射后仍会修正）");

  S.weapons = [{ id: "nugget", lvl: 1, timer: 0, orbit: 0 }];
  S.bullets.length = 0;
  b.T.update(DT);
  const nb = S.bullets[0];
  ok(!!nb && Math.abs(nb.ang) < 0.35, `麦乐鸡初始方向也朝敌（ang=${nb ? nb.ang.toFixed(3) : "无"}）`);

  // 无敌人：朝玩家面向（旧版会朝上乱打）
  S.enemies.length = 0; S.bullets.length = 0;
  S.player.face = Math.PI / 2;
  S.weapons = [{ id: "ketchup", lvl: 1, timer: 0, orbit: 0 }];
  b.T.update(DT);
  const fb = S.bullets[0];
  ok(!!fb && Math.abs(fb.ang - Math.PI / 2) < 0.05, "无敌人时朝玩家面向发射（不再固定朝天）");
}

console.log("\n15) 食物立绘（怪物全部换成真实餐品图）");
{
  const slugs = Object.keys(T.SPRITES);
  ok(slugs.length === 12, `构建注入 12 张立绘：实际 ${slugs.length}`);
  ok(Object.values(T.SPRITES).every((u) => u.startsWith("data:image/webp;base64,")), "全部是内联 webp（离线可玩，零外链）");
  const noSlug = T.ARCH.filter((a) => !a.slug);
  ok(noSlug.length === 0, `${T.ARCH.length} 种餐品全部带 slug（缺 ${noSlug.length}）`);
  const badSlug = T.ARCH.filter((a) => !T.SPRITES[a.slug]);
  ok(badSlug.length === 0, "所有 slug 都指向存在的立绘（无「无名色块怪」）");
  const pick = (n) => T.ARCH.find((a) => a.name.includes(n)) || {};
  ok(pick("安格斯").slug === "burger-angus", "与出餐口同口径：「安格斯」→ burger-angus");
  ok(pick("麦乐鸡").slug === "nuggets", "「麦乐鸡」→ nuggets");
  ok(pick("薯条").slug === "fries", "「薯条」→ fries");

  // 渲染真的走 drawImage（FakeImage 赋 src 同步就绪）
  const b = makeBootCtx();
  b.T.reset(20261009, { autoStart: true });
  for (let i = 0; i < 60 * 5; i++) { b.T.update(DT); if (b.T.state().levelup) b.T.choose(0); }
  b.ctx._draws = 0;
  b.T.render();
  ok(b.ctx._draws > 0, `渲染走立绘路径（一帧 drawImage × ${b.ctx._draws}）`);

  // 负向控制：无 Image（老内核）⇒ 回退色块圆，不崩
  const b2 = makeBootCtx(null, { noImage: true });
  b2.T.reset(20261009, { autoStart: true });
  for (let i = 0; i < 60 * 5; i++) { b2.T.update(DT); if (b2.T.state().levelup) b2.T.choose(0); }
  let boom = null;
  try { b2.T.render(); } catch (e) { boom = e; }
  ok(!boom, "无 Image 老内核：渲染自动回退色块，不抛错");
  ok(b2.ctx._draws === 0, "回退路径不调用 drawImage（负向控制成立）");
}

console.log("\n16) 产物体积（立绘内联后的预算）");
{
  ok((html.match(/data:image\/webp;base64,/g) || []).length >= 12, "产物里内联 ≥12 张 webp");
  const bytes = Buffer.byteLength(html, "utf8");
  ok(bytes < 300 * 1024, `产物 ${(bytes / 1024).toFixed(0)}KB < 300KB 预算（弱网也能几秒打开）`);
}

console.log("\n17) 怪物威胁系统（特质 / 精英 / 出餐高峰 / 敌方子弹）");
{
  // —— 特质按立绘归类（看立绘识危险）——
  const archOf = (slug) => T.ARCH.find((a) => a.slug === slug) || {};
  ok(archOf("nuggets").trait === "split", "麦乐鸡类（nuggets）→ 分裂（一盒散一地）");
  ok(archOf("fries").trait === "dash", "薯条类（fries）→ 冲刺（撒出来跑得快）");
  ok(archOf("wings").trait === "boom", "辣翅类（wings）→ 死亡爆炸");
  ok(archOf("cola").trait === "spit" && archOf("coffee").trait === "spit", "饮料/咖啡（cola/coffee）→ 喷弹");
  ok(archOf("burger-double").trait === null && archOf("muffin").trait === null, "汉堡/麦满分类 → 无特质（普通怪）");
  ok((T.ARCH.find((a) => a.name.includes("麦乐鸡")) || {}).slug === "nuggets", "名字抽查：「麦乐鸡」确实归入 nuggets");
  const byTrait = { split: 0, dash: 0, boom: 0, spit: 0 };
  T.ARCH.forEach((a) => { if (a.trait) byTrait[a.trait]++; });
  ok(byTrait.split >= 1 && byTrait.dash >= 1 && byTrait.boom >= 1 && byTrait.spit >= 1,
    `四类特质各至少 1 种：${JSON.stringify(byTrait)}`);
  ok(T.ARCH.every((a) => a.trait === null || ["split", "dash", "boom", "spit"].includes(a.trait)), "特质取值全部合法");

  const b = makeBootCtx();
  b.T.reset(20261009, { autoStart: true });
  const S = b.T.state();
  const find = (n) => T.ARCH.find((a) => a.name.includes(n));
  const mk = (arch, x, y, extra) => {
    const e = { x, y, r: arch.r, arch, hp: 60, maxHp: 60, speed: arch.speed,
      dmg: 5, xp: 4, boss: false, elite: false, mini: false, trait: arch.trait,
      dashCd: 0.5, dashT: 0, spitCd: 9, hitCd: 0, flash: 0, wob: 0, dead: false };
    Object.assign(e, extra || {});
    S.enemies.push(e);
    return e;
  };

  // —— 分裂：倒下散 3 块；鸡块不再分裂、体型血量缩水 ——
  S.enemies.length = 0;
  const sp = mk(find("麦乐鸡"), 400, 0);
  b.T.killEnemy(sp);
  const minis = S.enemies.filter((e) => e.mini);
  ok(minis.length === 3, `麦乐鸡倒下分裂出 3 块小鸡块（实际 ${minis.length}）`);
  ok(minis.every((m) => m.trait === null && m.r < sp.r && m.hp <= sp.maxHp * 0.25),
    "小鸡块：不再分裂、体型与血量都缩水");

  // —— 爆炸：贴脸杀会被溅伤；远处安全 ——
  S.enemies.length = 0; S.player.x = 0; S.player.y = 0;
  S.player.hp = 100; S.player.invuln = 0;
  const bo = mk(find("麦辣鸡翅"), 60, 0, { trait: "boom" });
  b.T.killEnemy(bo);
  ok(S.player.hp === 91, `辣翅在 60px 处倒下炸掉 9 血（hp=${S.player.hp}）`);
  S.player.invuln = 0;
  const bo2 = mk(find("麦辣鸡翅"), 300, 0, { trait: "boom" });
  b.T.killEnemy(bo2);
  ok(S.player.hp === 91, "300px 外的爆炸不伤人（只有贴脸才危险）");

  // —— 喷弹：进射程周期吐弹；弹可命中玩家 ——
  S.enemies.length = 0; S.ebullets.length = 0;
  mk(find("可乐"), 300, 0, { spitCd: 0.05 });
  let sawBullet = false;
  for (let i = 0; i < 90 && !sawBullet; i++) { b.T.update(DT); if (S.ebullets.length > 0) sawBullet = true; }
  ok(sawBullet, "饮料怪进入射程后喷出敌方子弹");
  S.enemies.length = 0; S.ebullets.length = 0;
  S.player.hp = 100; S.player.invuln = 0;
  S.ebullets.push({ x: 10, y: 0, vx: 0, vy: 0, r: 6, dmg: 8, life: 2 });
  b.T.update(DT);
  ok(S.player.hp === 92 && S.ebullets.length === 0, `敌方子弹命中玩家扣 8 血并消失（hp=${S.player.hp}）`);

  // —— 冲刺：出现远超基础速度的峰值 ——
  S.enemies.length = 0; S.ebullets.length = 0;
  S.player.hp = 100; S.player.invuln = 0;
  const da = mk(find("薯条"), 320, 0, { dashCd: 0.1 });
  let maxV = 0, pv = { x: da.x, y: da.y };
  for (let i = 0; i < 100; i++) {
    b.T.update(DT);
    const v = Math.hypot(da.x - pv.x, da.y - pv.y) / DT;
    if (v > maxV) maxV = v;
    pv = { x: da.x, y: da.y };
  }
  ok(maxV > da.speed * 2, `薯条冲刺峰值 ${Math.round(maxV)}px/s > 基础 ${Math.round(da.speed)}px/s 的 2 倍`);

  // —— 出餐高峰：45s 一波环形加压 ——
  S.enemies.length = 0; S.ebullets.length = 0;
  S.time = 44.5; S.nextPeakAt = 45; S.spawnTimer = 99;
  for (let i = 0; i < 60; i++) b.T.update(DT);
  ok(S.nextPeakAt === 90, "出餐高峰触发后，下一波排到 90s");
  ok(S.enemies.length >= 6, `高峰一口刷出 ${S.enemies.length} 只（≥6）`);

  // —— 精英：时间拉高后按概率产出（确定性 rng 抽样） ——
  b.T.reset(777, { autoStart: true });
  const s2 = b.T.state(); s2.time = 300;
  let eliteN = 0;
  for (let i = 0; i < 120; i++) { const e = b.T.spawnEnemy(T.ARCH[0], false); if (e && e.elite) eliteN++; }
  ok(eliteN >= 3, `高时段 120 次抽样出 ${eliteN} 只精英（≥3）`);

  // —— 集成扫描：真实局里四类特质怪 + 鸡块 + 敌弹 + 精英 都会出现 ——
  const c = makeBootCtx();
  c.T.reset(424242, { autoStart: true });
  const bot2 = (st2, i) => {
    const P = st2.player;
    if (i % 4 !== 0) return;
    let near = null, nd = Infinity;
    for (const e of st2.enemies) { const d = (e.x - P.x) ** 2 + (e.y - P.y) ** 2; if (d < nd) { nd = d; near = e; } }
    let tx = null, ty = null;
    if (near && nd < 130 * 130) {
      const dx = P.x - near.x, dy = P.y - near.y, m = Math.hypot(dx, dy) || 1;
      tx = P.x + (dx / m) * 240; ty = P.y + (dy / m) * 240;
    } else {
      let g = null, gd = Infinity;
      for (const gg of st2.gems) { const d = (gg.x - P.x) ** 2 + (gg.y - P.y) ** 2; if (d < gd) { gd = d; g = gg; } }
      if (g) { tx = g.x; ty = g.y; }
    }
    if (tx !== null) { c.T.pointer.active = true; c.T.pointer.x = tx; c.T.pointer.y = ty; }
  };
  const seenT = { split: 0, dash: 0, boom: 0, spit: 0 };
  let seenMini = false, seenEbullet = false, seenElite = false;
  for (let i = 0; i < 60 * 150; i++) {
    const st = c.T.state();
    bot2(st, i);
    c.T.update(DT);
    if (st.levelup) c.T.choose(0);
    for (const e of st.enemies) {
      if (e.trait) seenT[e.trait]++;
      if (e.mini) seenMini = true;
      if (e.elite) seenElite = true;
    }
    if (st.ebullets.length) seenEbullet = true;
    if (st.over) break;
  }
  c.T.pointer.active = false;
  ok(seenT.split > 0 && seenT.dash > 0 && seenT.boom > 0 && seenT.spit > 0,
    `150s 真实局四类特质怪都刷到过：${JSON.stringify(seenT)}`);
  ok(seenMini && seenEbullet && seenElite,
    `鸡块/敌弹/精英也都出现过（mini=${seenMini} ebullet=${seenEbullet} elite=${seenElite}）`);
}

console.log("\n18) 麦门爆发（血量首次跌破 20% 自动清场，每局一次）");
{
  const b = makeBootCtx();
  b.T.reset(20261009, { autoStart: true });
  const S = b.T.state();
  const find = (n) => T.ARCH.find((a) => a.name.includes(n));
  const plain = find("巨无霸");   // 无特质普通怪
  const mkOn = (st, arch, x, y, extra) => {
    const e = { x, y, r: arch.r, arch, hp: 60, maxHp: 60, speed: arch.speed,
      dmg: arch.dmg, xp: 4, boss: false, elite: false, mini: false, trait: arch.trait,
      dashCd: 9, dashT: 0, spitCd: 9, hitCd: 0, flash: 0, wob: 0, dead: false };
    Object.assign(e, extra || {});
    st.enemies.push(e);
    return e;
  };

  ok(S.burstUsed === false, "开局：爆发未使用");

  // —— 触发（黑盒路径：接触伤害）：21% 血被贴身怪打一下 ⇒ 清场 ——
  S.enemies.length = 0;
  S.player.x = 0; S.player.y = 0; S.player.hp = 21; S.player.invuln = 0;
  const nearGuy = mkOn(S, plain, 10, 0, { speed: 0 });
  const midGuy = mkOn(S, plain, 500, 0, { speed: 0 });
  const farGuy = mkOn(S, plain, 900, 0, { speed: 0 });
  b.T.update(DT);
  ok(S.burstUsed === true, "血量首次跌破 20% ⇒ 自动触发麦门爆发");
  ok(S.player.hp > 0 && S.player.hp <= 20, `玩家活着且血量在阈值内（hp=${S.player.hp.toFixed(1)}）`);
  ok(nearGuy.dead && midGuy.dead, "视野内小怪（10px / 500px）被秒杀");
  ok(!farGuy.dead, "视野外（900px）的怪不受影响");
  ok(S.fx.some((f) => f.kind === "flash") && S.fx.some((f) => f.kind === "ring"), "爆发伴随白闪 + 冲击波");
  ok(S.shake > 0, `触发瞬间震屏（shake=${S.shake.toFixed(2)}）`);

  // —— 每局仅一次：再次跌血不再清场 ——
  S.player.invuln = 0;
  S.player.hp = 30;
  const again = mkOn(S, plain, 10, 0, { speed: 0 });
  b.T.update(DT);
  ok(!again.dead && S.burstUsed === true, "第二次跌血不再触发（每局仅一次）");
  ok(S.player.hp > 0 && S.player.hp < 30, `这次只吃普通伤害（hp=${S.player.hp.toFixed(1)}）`);

  // —— BOSS 不秒杀只吃重伤；分裂怪不分裂、辣翅不反炸（quiet 模式） ——
  b.T.reset(20261010, { autoStart: true });
  const S2 = b.T.state();
  S2.enemies.length = 0;
  S2.player.x = 0; S2.player.y = 0; S2.player.hp = 21; S2.player.invuln = 0;
  const boss = mkOn(S2, plain, 300, 0, { boss: true, hp: 3000, maxHp: 3000, speed: 0 });
  mkOn(S2, find("麦乐鸡"), 400, 60, { speed: 0 });
  mkOn(S2, find("麦辣鸡翅"), 90, 0, { speed: 0 });     // 若爆炸未被抑制，玩家在 98px 内会再吃 9 点
  mkOn(S2, plain, 10, 0, { speed: 0 });                 // 触发用贴身怪
  b.T.update(DT);
  ok(S2.burstUsed === true, "新一局：爆发重置后再次触发");
  ok(boss.hp === 2680 && !boss.dead, `BOSS 不被秒杀，只吃 320 固定伤害（hp=${boss.hp}）`);
  ok(!S2.enemies.some((e) => e.mini), "被爆死的麦乐鸡不分裂（quiet 抑制）");
  ok(!S2.over && Math.abs(S2.player.hp - (21 - plain.dmg)) < 0.01,
    `被爆死的辣翅不反炸玩家（hp=${S2.player.hp.toFixed(1)}，恰好只有一次普通伤害）`);

  // —— 渲染路径：白闪/震屏/冲击波 不崩 ——
  let boom = null;
  try { b.T.render(); } catch (e) { boom = e; }
  ok(!boom, "爆发后渲染（白闪/震屏/冲击波）无异常");
}

console.log("\n19) BOSS 爆发「超大份」（蓄力 1s 预警 → 劈半血）");
{
  const b = makeBootCtx();
  const find = (n) => T.ARCH.find((a) => a.name.includes(n));
  const plain = find("巨无霸");
  const mkOn = (st, x, y, extra) => {
    const e = { x, y, r: plain.r * 2, arch: plain, hp: 3000, maxHp: 3000, speed: 0,
      dmg: plain.dmg, xp: 40, boss: true, elite: false, mini: false, trait: plain.trait,
      dashCd: 9, dashT: 0, spitCd: 9, burstCd: 0.05, chargeT: 0,
      hitCd: 0, flash: 0, wob: 0, dead: false };
    Object.assign(e, extra || {});
    st.enemies.push(e);
    return e;
  };

  // ① 冷却到期 + 玩家在 420px 内 ⇒ 蓄力；蓄力中站定
  b.T.reset(20261009, { autoStart: true });
  const S = b.T.state();
  S.weapons = [];                              // 清掉武器：本组只测 BOSS 行为，避免输出干扰精确值
  S.enemies.length = 0;
  S.player.x = 0; S.player.y = 0; S.player.hp = 60; S.player.invuln = 0;
  const boss = mkOn(S, 300, 0);
  b.T.update(DT);
  ok(boss.chargeT === 0 && boss.burstCd > 0, "冷却未到：不蓄力");
  for (let i = 0; i < 6; i++) b.T.update(DT);
  ok(boss.chargeT > 0, `冷却到期 + 玩家在 420px 内 ⇒ 进入蓄力（chargeT=${boss.chargeT.toFixed(2)}s）`);
  const bx0 = boss.x, by0 = boss.y;
  for (let i = 0; i < 10; i++) b.T.update(DT);
  ok(boss.x === bx0 && boss.y === by0, "蓄力中 BOSS 站定（这就是能躲的全部原因）");

  // ② 释放：340px 内 → 血量精确减半（60 → 30）；红闪 + 红冲击波
  let sawFlash = false, sawRing = false;
  for (let i = 0; i < 70; i++) {
    b.T.update(DT);
    if (S.fx.some((f) => f.kind === "flash" && f.color === "#ff3b30")) sawFlash = true;
    if (S.fx.some((f) => f.kind === "ring" && f.color === "#ff5b4d")) sawRing = true;
  }
  ok(boss.chargeT === 0, "蓄力结束即释放");
  ok(boss.burstCd > 5, `释放后进入冷却（burstCd=${boss.burstCd.toFixed(1)}s）`);
  ok(S.player.hp === 30, `300px 内被劈半：60 → ${S.player.hp}`);
  ok(sawFlash && sawRing, "释放伴随红闪 + 红色冲击波");

  // ③ 躲开：蓄力后跑出 340px ⇒ 不中
  b.T.reset(20261010, { autoStart: true });
  const S2 = b.T.state();
  S2.weapons = [];
  S2.enemies.length = 0;
  S2.player.x = 0; S2.player.y = 0; S2.player.hp = 80; S2.player.invuln = 0;
  const boss2 = mkOn(S2, 300, 0);
  for (let i = 0; i < 8; i++) b.T.update(DT);
  ok(boss2.chargeT > 0, "第二局：再次进入蓄力");
  S2.player.x = 900;                           // 模拟玩家跑出预警圈（boss 在 x=300，距离拉到 600px）
  for (let i = 0; i < 70; i++) b.T.update(DT);
  ok(S2.player.hp === 80, `跑出 340px 预警圈 ⇒ 不挨劈（hp=${S2.player.hp}）`);

  // ④ 保底：1 血被劈不会死
  b.T.reset(20261011, { autoStart: true });
  const S3 = b.T.state();
  S3.weapons = [];
  S3.enemies.length = 0;
  S3.player.x = 0; S3.player.y = 0; S3.player.hp = 1; S3.player.invuln = 0;
  mkOn(S3, 300, 0);
  for (let i = 0; i < 80; i++) b.T.update(DT);
  ok(S3.player.hp === 1 && !S3.over, `1 血被劈：劈半保底，不死（hp=${S3.player.hp}）`);

  // ⑤ 联动：40 血被劈成 20（=20%）⇒ 触发「麦门爆发」清场
  b.T.reset(20261012, { autoStart: true });
  const S4 = b.T.state();
  S4.weapons = [];
  S4.enemies.length = 0;
  S4.player.x = 0; S4.player.y = 0; S4.player.hp = 40; S4.player.invuln = 0;
  const boss3 = mkOn(S4, 300, 0);
  const minion = mkOn(S4, 200, 150, { boss: false, hp: 60, maxHp: 60, xp: 4 });
  for (let i = 0; i < 80; i++) b.T.update(DT);
  ok(S4.player.hp === 20 && S4.burstUsed === true,
    `40 血被劈成 20（恰好 20%）⇒ 自动触发麦门爆发（hp=${S4.player.hp}）`);
  ok(minion.dead, "爆发顺手清掉了场上小怪（联动成立）");
  ok(boss3.hp === 2680, `BOSS 也吃了爆发重伤：3000 → ${boss3.hp}`);

  // ⑥ 玩家在 420px 外：冷却到期也不蓄力（不空放）
  b.T.reset(20261013, { autoStart: true });
  const S5 = b.T.state();
  S5.weapons = [];
  S5.enemies.length = 0;
  S5.player.x = 0; S5.player.y = 0; S5.player.hp = 60;
  const boss5 = mkOn(S5, 500, 0);
  for (let i = 0; i < 30; i++) b.T.update(DT);
  ok(boss5.chargeT === 0 && boss5.burstCd <= 0, "玩家在 420px 外：冷却到期也不蓄力（不空放）");

  // ⑦ 渲染路径：蓄力预警圈 + 红闪 不崩
  let boomB = null;
  try {
    b.T.reset(20261014, { autoStart: true });
    const S6 = b.T.state();
    S6.enemies.length = 0; S6.player.hp = 60;
    mkOn(S6, 300, 0);
    for (let i = 0; i < 20; i++) b.T.update(DT);   // 蓄力中
    b.T.render();                                   // 画预警圈（收缩环 + 范围）
    for (let i = 0; i < 70; i++) b.T.update(DT);
    b.T.render();                                   // 释放后
  } catch (e) { boomB = e; }
  ok(!boomB, "蓄力预警圈与红闪的渲染无异常");
}

console.log(`\n结果：${pass} 通过 / ${fail} 失败`);
process.exit(fail ? 1 : 0);
