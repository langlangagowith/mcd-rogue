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
ok(s4.kills > s3.kills, `走位击杀更多（${s4.kills} > ${s3.kills}）`);
ok(s4.time > 60, `走位能活过 60s：实际 ${s4.time.toFixed(1)}s`);
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

console.log("\n8) 启动装配与渲染路径（完整 DOM 桩，补上渲染盲区）");
{
  // 第 1~7 节把 DOM 桩成 null ⇒ boot() 直接退出、render() 从未执行。
  // 这里换成"能跑通的完整桩"，确认 boot() 与 render() 不抛异常（否则浏览器里就是白屏）。
  // 严格桩：只认真实的 canvas 2D 成员。任何打错的方法名都会真的抛 TypeError
  // （宽松 Proxy 会把错别字一律吞成空函数，等于没测）。
  const CTX_METHODS = ["arc", "arcTo", "beginPath", "closePath", "fill", "fillRect", "fillText",
    "lineTo", "moveTo", "restore", "rotate", "save", "setTransform", "stroke", "translate"];
  const ctxStub = { measureText: () => ({ width: 10 }) };
  for (const m of CTX_METHODS) ctxStub[m] = () => {};
  const els = new Map();
  const mkEl = (id) => {
    if (els.has(id)) return els.get(id);
    const el = {
      id, style: {}, innerHTML: "", textContent: "", onclick: null,
      clientWidth: 800, clientHeight: 600, width: 0, height: 0,
      classList: {
        _s: new Set(),
        add(c) { this._s.add(c); }, remove(c) { this._s.delete(c); },
        contains(c) { return this._s.has(c); }
      },
      getContext: () => ctxStub,
      getBoundingClientRect: () => ({ left: 0, top: 0, width: 800, height: 600 }),
      appendChild: () => {}, addEventListener: () => {}, querySelectorAll: () => [],
      type: "", className: ""
    };
    els.set(id, el);
    return el;
  };
  const ctx2 = vm.createContext({
    console, URLSearchParams,
    document: { getElementById: mkEl, createElement: () => mkEl("__new__" + els.size), addEventListener: () => {} },
    location: { search: "", href: "" },
    requestAnimationFrame: () => 0,
    window: {
      addEventListener: () => {}, devicePixelRatio: 1, innerWidth: 800, innerHeight: 600,
      matchMedia: () => ({ matches: false })
    }
  });
  let boom = null;
  try { vm.runInContext(js, ctx2, { filename: "neon.html(boot)" }); } catch (e) { boom = e; }
  ok(!boom, boom ? `boot() 抛异常：${boom.message}` : "boot() 在完整 DOM 桩下装配成功（含首次 render）");

  const T2 = ctx2.McSurvivor;
  ok(!!T2 && typeof T2.render === "function", "同时导出 render，可独立驱动渲染");
  if (T2 && T2.render) {
    let boom2 = null;
    try {
      T2.reset(20261009, { autoStart: true });
      for (let i = 0; i < 60 * 20; i++) { T2.update(DT); if (T2.state().levelup) T2.choose(0); T2.render(); }
      T2.state().levelup = { cards: [{ type: "weapon", id: "cola", lvl: 1, name: "x", icon: "1", desc: "d" }], at: 2 };
      T2.render();
    } catch (e) { boom2 = e; }
    ok(!boom2, boom2 ? `渲染/推进抛异常：${boom2.message}` : "连续 20s 推进 + 逐帧 render 无异常");
  }
}

console.log("\n9) 产物静态自检");
{
  ok(/<title>[^<]*麦门幸存者[^<]*<\/title>/.test(html), "标题含游戏名");
  ok(!html.includes("__NEON_DATA__"), "注入占位符已全部替换");
  const openTags = (html.match(/<script>/g) || []).length;
  const closeTags = (html.match(/<\/script>/g) || []).length;
  ok(openTags === closeTags && openTags > 0, `script 标签闭合（${openTags} 开 ${closeTags} 闭）`);
  ok(html.trimEnd().endsWith("</html>"), "文件结构完整收尾于 </html>");
}

console.log(`\n结果：${pass} 通过 / ${fail} 失败`);
process.exit(fail ? 1 : 0);
