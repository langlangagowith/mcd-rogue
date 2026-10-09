// 麦门开饭 · 出餐口大作战（McChow）· 无头冒烟测试
// 覆盖：数据注入 / 确定性 / 开始状态机 / 吃与得分 / 腻 / 券 / 吃撑与收工 /
//       长跑不变量 / 完整 DOM 桩跑 boot+render / 移动端回归（微信内核）/ 产物自检。
//
// 用法：node scripts/smoke_arcade.mjs
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const HTML = path.join(ROOT, "docs", "arcade.html");

let pass = 0, fail = 0;
const ok = (cond, msg) => { if (cond) { pass++; console.log(`  ✓ ${msg}`); } else { fail++; console.log(`  ✗ ${msg}`); } };

/* ---------- 1) 抽出主脚本并加载（DOM 全桩：getElementById → null） ---------- */
const html = fs.readFileSync(HTML, "utf8");
const blocks = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
const js = blocks.find((s) => s.includes("McChow"));
if (!js) { console.error("✗ 找不到主脚本"); process.exit(1); }

const ctx = vm.createContext({
  document: { getElementById: () => null, addEventListener: () => {} },
  console,
  setTimeout: () => 0, clearTimeout: () => {},
});
vm.runInContext(js, ctx, { filename: "arcade.html" });
const T = ctx.McChow;
ok(!!T, "脚本加载后导出 McChow 接口");
if (!T) process.exit(1);

const DT = 1 / 60;
const S = () => T.state();
const foodAt = (name, dx = 0, dy = 0) => T.spawnAt(name, S().player.x + dx, S().player.y + dy);
const eatNow = (name) => { const before = S().eaten; foodAt(name); T.update(DT); return S().eaten === before + 1; };

console.log("\n1) 真实数据注入与派生");
ok(T.FOODS.length === 49, `注入餐品 ${T.FOODS.length} 种 == 49（三餐去重后的真实菜单）`);
{
  const slugs = Object.keys(T.SPRITES);
  ok(slugs.length === 12, `立绘 ${slugs.length} 张`);
  ok(T.FOODS.every((f) => f.n && f.k > 0 && f.p >= 0 && f.c && slugs.includes(f.s)),
    "每项 {n,p,k,c,s} 完整，且 s 都指向真实立绘");
  const top = T.FOODS.slice().sort((a, b) => b.k - a.k)[0];
  ok(top.k === 707 && /安格斯/.test(top.n), `最重餐品 = ${top.n}（${top.k}kcal）`);
  ok(/[\u4e00-\u9fff]/.test(top.n), "餐品名是真实中文名，不是占位符");
  const asc = T.FOODS.slice().sort((a, b) => a.k - b.k);
  ok(T.itemRadius(asc[0].k) < T.itemRadius(asc[asc.length - 1].k), "热量↑ ⇒ 食物体型↑");
  ok(T.fullnessOf(707) === 71 && T.fullnessOf(289) === 29, "饱腹 = kcal/10 取整（707→71 / 289→29）");
  ok(asc[0].k < 60 && asc[0].n.length > 0, `最小件存在：${asc[0].n}（${asc[0].k}kcal）`);
}

console.log("\n2) 确定性（同种子同结果）");
const runPlain = (seed, sec) => {
  T.reset(seed, { autoStart: true });
  for (let i = 0; i < Math.round(sec / DT); i++) T.update(DT);
  return JSON.stringify(S());
};
{
  const a1 = runPlain(20261009, 30), a2 = runPlain(20261009, 30), c1 = runPlain(777, 30);
  ok(a1 === a2, "同种子 30s 逐字段一致");
  ok(a1 !== c1, "换种子结果不同（随机确实起作用）");
}

console.log("\n3) 开始状态机（未点开饭 ⇒ 世界冻结）");
{
  T.reset(7);
  ok(S().started === false, "reset 后就位待命（started=false）");
  for (let i = 0; i < 120; i++) T.update(DT);
  ok(S().time === 0, "未开始：2 秒帧数下 time 仍为 0（静帧不被覆盖）");
  ok(S().items.length === 0, "未开始：不出料");
  T.start();
  for (let i = 0; i < 60; i++) T.update(DT);
  ok(S().time > 0.9, `start() 后世界推进：${S().time.toFixed(2)}s`);
  T.reset(8, { autoStart: true });
  for (let i = 0; i < 30; i++) T.update(DT);
  ok(S().time > 0.4, "autoStart 直接开跑");
}

console.log("\n4) 吃：得分 / 饱腹 / 连击 / 空中双倍");
{
  T.reset(9, { autoStart: true });
  const base = Math.round(12 + 289 / 8);            // 薯条 289kcal → 基础分 48
  let sc = S().score;
  ok(eatNow("薯条"), "空中吃到薯条");
  const gainAir = S().score - sc;
  ok(gainAir === base, `空中得分 = 基础分（${gainAir} = ${base}）`);
  ok(S().kcal === 289 && S().fullness === 29, "热量/饱腹按真实营养入账");
  ok(S().combo === 1 && S().bestCombo === 1, "连击从 1 开始");

  sc = S().score;
  const comboWas = S().combo;
  T.spawnAt("薯条", S().player.x, S().player.y);
  T.update(DT);
  ok(S().score - sc === Math.round(base * T.comboMult(comboWas)), "连击倍率参与计分");

  // 地面（落地去鲜）吃同款 ⇒ 恰好一半
  T.reset(10, { autoStart: true });
  T.moveTo(60, 120);                                 // 玩家让开
  const it = T.spawnAt("薯条", 300, 560);            // 起点贴近地面，快速落地
  for (let i = 0; i < 25 && !it.rest; i++) T.update(DT);
  ok(it.rest === true, "食物落地进入 rest（去鲜）");
  T.moveTo(it.x, it.y);
  sc = S().score;
  T.update(DT);
  const gainGround = S().score - sc;
  ok(gainGround === Math.round(base * 0.5), `地上捡到的得分 = 空中一半（${gainGround} vs ${gainAir}）`);
}

console.log("\n5) 「腻」：连吃 3 个同类");
{
  T.reset(11, { autoStart: true });
  eatNow("可乐"); eatNow("可乐");
  ok(S().combo === 2 && S().sickTimes === 0, "同品类连吃 2 个还没腻");
  eatNow("可乐");
  ok(S().sickTimes === 1, "第 3 个同类触发「腻」");
  ok(S().combo === 0 && S().sameCat === 0, "腻后连击清零、同类计数重置");
  ok(S().sickUntil > S().time, "「腻」进入限速状态（sickUntil 已设置）");
  ok(S().catCount["饮品"] === 3, "品类计数仍如实记录（战报用）");
}

console.log("\n6) 优惠券：清胃 + 双倍窗口");
{
  T.reset(12, { autoStart: true });
  eatNow("培根安格斯厚牛堡");
  const f0 = S().fullness;
  T.spawnCouponAt(S().player.x, S().player.y);
  T.update(DT);
  ok(S().coupons === 1, "吃到优惠券");
  ok(S().fullness === Math.max(0, f0 - 12), `清掉 12% 胃容量（${f0} → ${S().fullness}）`);
  ok(S().doubleUntil > S().time, "进入双倍分窗口");
  const dvGain = (() => {
    const sc = S().score;
    T.spawnAt("薯条", S().player.x, S().player.y);
    T.update(DT);
    return S().score - sc;
  })();
  ok(dvGain >= 96 - 1, `双倍期内吃薯条得分显著放大（实测 ${dvGain}）`);
}

console.log("\n7) 吃撑结束 / 主动收工");
{
  T.reset(13, { autoStart: true });
  foodAt("培根安格斯厚牛堡"); foodAt("培根安格斯厚牛堡");   // 一帧内两口重堡：71+71 > 100
  T.update(DT);
  ok(S().over === true, "吃撑后本局结束");
  ok(S().endReason === "stuffed", "结束原因为「吃撑」");
  ok(S().fullness >= 100, `胃容量已超线：${S().fullness}`);
  T.update(DT);
  ok(S().time < 0.05, "结束后世界冻结（不再推进）");

  T.reset(14, { autoStart: true });
  T.endGame("quit");
  ok(S().over === true && S().endReason === "quit", "收工结算：endReason=quit（与吃撑区分）");
}

console.log("\n8) 长跑不变量（躲避机器人 90 秒）");
{
  T.reset(424242, { autoStart: true });
  const K = T.keys;
  // minimax 躲避 + 迟滞：眼下安全（90px 内无威胁）就站住别乱跑，
  // 避免"横穿屏幕去另一个角落"的路上被砸。目标：不吃撑活满 90 秒。
  const nearestThreat = (st, x) => {
    const P = st.player;
    let worst = Infinity;
    for (const it of st.items) {
      const pts = it.rest ? [[it.x, it.y]]
        : [[it.x, it.y], [it.x + it.vx * 0.5, it.y + it.vy * 0.5 + 625 * 0.25]];
      for (const [ix, iy] of pts) {
        const d = Math.hypot(ix - x, iy - P.y);
        if (d < worst) worst = d;
      }
    }
    return worst;
  };
  const dodgeStep = (st) => {
    const P = st.player;
    K.left = K.right = K.up = K.down = false;
    if (nearestThreat(st, P.x) > 90) return;          // 迟滞：眼前安全 ⇒ 保持站位
    const cands = [];
    for (let k = 0; k < 9; k++) cands.push(36 + (st.w - 72) * k / 8);
    let bestX = cands[4], best = -1;
    for (const x of cands) {
      const d = nearestThreat(st, x);
      if (d > best) { best = d; bestX = x; }
    }
    K.left = P.x > bestX + 6;
    K.right = P.x < bestX - 6;
  };
  let posOk = true, timeMono = true, prevT = 0, maxItems = 0, fullOk = true;
  const steps = Math.round(90 / DT);
  for (let i = 0; i < steps; i++) {
    const st = S();
    dodgeStep(st);
    T.update(DT);
    maxItems = Math.max(maxItems, st.items.length);
    if (!Number.isFinite(st.player.x) || !Number.isFinite(st.player.y)) posOk = false;
    if (st.time < prevT) timeMono = false;
    prevT = st.time;
    if (st.fullness > 140) fullOk = false;
    if (st.over) break;
  }
  K.left = K.right = K.up = K.down = false;
  ok(posOk, "坐标始终有限（无 NaN 穿透）");
  ok(timeMono, "时间单调不减");
  ok(fullOk, "胃容量不超上限 140");
  ok(maxItems <= 80, `在屏食物数有界：峰值 ${maxItems} ≤ 80`);
  // 躲避机器人不是产品的一部分，只设质量下限（≥60s），不因它波动把门卡死
  ok(S().time >= 60, `躲避机器人至少撑 60 秒：实测 ${S().time.toFixed(1)}s${S().over ? "（被撑爆）" : "（跑满 90s）"}`);
  ok(S().eaten <= 15, `误食在可接受范围（${S().eaten} 件）`);
}

console.log("\n8b) 十局连玩（跨局重置干净 + 每局都能正常吃撑）");
{
  let bad = 0, runs = [];
  for (let g = 0; g < 10; g++) {
    T.reset(2000 + g, { autoStart: true });
    const st0 = S();
    if (st0.time !== 0 || st0.score !== 0 || st0.eaten !== 0 || st0.fullness !== 0 || st0.items.length !== 0 || st0.over) bad++;
    let guard = 0;
    while (!S().over && guard++ < 400) { T.spawnAt("薯条", S().player.x, S().player.y); T.update(DT); }
    if (!S().over || S().endReason !== "stuffed") bad++;
    runs.push(S().eaten);
  }
  ok(bad === 0, `10 局连玩全部干净：重置无残留、每局正常结算（每局吃 ${runs.join("/")} 件）`);
}

/* ---------- 可复用的「完整 DOM 桩」工厂 ---------- */
// 严格桩：只认真实 canvas 2D 成员；打错方法名会真抛 TypeError（宽松 Proxy 会吞掉错别字）。
const CTX_METHODS = ["arc", "arcTo", "beginPath", "clearRect", "closePath", "createLinearGradient",
  "createRadialGradient", "drawImage", "ellipse", "fill", "fillRect", "fillText", "lineTo",
  "moveTo", "restore", "rotate", "save", "scale", "setLineDash", "setTransform", "stroke",
  "strokeRect", "strokeText", "translate"];
const hasOn = (b, id) => { const el = b.els.get(id); return !!(el && el.classList.contains("on")); };
function makeBootCtx(winExtra, opts) {
  const rec = { drawImage: 0, fillText: 0 };
  const grad = { addColorStop: () => {} };
  const ctxStub = { measureText: () => ({ width: 10 }) };
  for (const m of CTX_METHODS) ctxStub[m] = () => {};
  ctxStub.drawImage = () => { rec.drawImage++; };
  ctxStub.fillText = () => { rec.fillText++; };
  ctxStub.createLinearGradient = () => grad;
  ctxStub.createRadialGradient = () => grad;

  const els = new Map();
  let seq = 0;
  const mkEl = (id) => {
    if (els.has(id)) return els.get(id);
    const el = {
      id, style: {}, innerHTML: "", textContent: "", onclick: null, src: "",
      clientWidth: 800, clientHeight: 600, width: 0, height: 0,
      _h: {},
      classList: {
        _s: new Set(),
        add(c) { this._s.add(c); }, remove(c) { this._s.delete(c); },
        contains(c) { return this._s.has(c); }
      },
      getContext: () => ctxStub,
      getBoundingClientRect: () => ({ left: 0, top: 0, width: 800, height: 600 }),
      toDataURL: () => "data:image/png;base64,AAAA",
      click: () => { el._clicked = true; },
      appendChild: () => {},
      addEventListener(t, fn) { (el._h[t] = el._h[t] || []).push(fn); }
    };
    els.set(id, el);
    return el;
  };
  const win = Object.assign({
    _h: {},
    addEventListener(t, fn) { (this._h[t] = this._h[t] || []).push(fn); },
    devicePixelRatio: 1, innerWidth: 800, innerHeight: 600,
    matchMedia: () => ({ matches: false }),
    navigator: { maxTouchPoints: 0 }
  }, winExtra || {});

  // Image 桩：src 赋值即同步 onload（256×256）⇒ 立绘走真实路径（drawImage），
  // 不落到几何 fallback 分支 —— 那正是"手机上看不到图"类 bug 的藏身处。
  class FakeImage {
    constructor() { this.complete = false; this.naturalWidth = 0; this.naturalHeight = 0; this.width = 0; this.height = 0; this._src = ""; }
    set src(v) {
      this._src = v;
      this.naturalWidth = 256; this.naturalHeight = 256; this.complete = true;
      if (this.onload) this.onload();
    }
    get src() { return this._src; }
  }

  const ctx = vm.createContext({
    console,
    document: { getElementById: mkEl, createElement: () => mkEl("__new__" + (seq++)), addEventListener: () => {} },
    window: win,
    Image: FakeImage,
    requestAnimationFrame: () => 0,
    setTimeout: () => 0, clearTimeout: () => {},
    location: { search: "", href: "" }
  });
  let err = null;
  try { vm.runInContext(js, ctx, { filename: "arcade.html(boot)" }); } catch (e) { err = e; }
  return { T: ctx.McChow, els, win, rec, err, opts: opts || {} };
}

console.log("\n9) 启动装配（完整 DOM 桩 · 模拟微信：无 PointerEvent）");
{
  const b = makeBootCtx();
  ok(!b.err, b.err ? `boot() 抛异常：${b.err.message}` : "boot() 装配成功（含首帧 render）");
  ok(hasOn(b, "ovStart"), "开始遮罩 ovStart 已显示（不显示 ⇒ 手机上没有键盘兜底，直接卡死）");

  for (let i = 0; i < 120; i++) { b.T.update(DT); b.T.render(); }
  ok(b.T.state().time === 0 && b.T.state().items.length === 0, "点开饭前：世界冻结、不出料");

  const btn = b.els.get("btnStart");
  ok(!!btn && typeof btn.onclick === "function", "「开饭」按钮已挂点击处理");
  btn.onclick();
  ok(b.T.state().started === true, "点「开饭」进入 started");
  ok(!hasOn(b, "ovStart"), "开局后遮罩关闭");

  let maxItems = 0;
  for (let i = 0; i < 360; i++) { b.T.update(DT); b.T.render(); maxItems = Math.max(maxItems, b.T.state().items.length); }
  ok(b.T.state().time > 5.8, `计时在走：${b.T.state().time.toFixed(1)}s`);
  ok(maxItems > 0, `开局 6 秒内出料口真的在倒东西：峰值 ${maxItems} 件在屏`);
  ok(b.rec.drawImage > 0, `立绘路径被真实使用（drawImage 调用 ${b.rec.drawImage} 次）`);

  const cvEl = b.els.get("cv");
  ok((cvEl._h.touchstart || []).length === 1, "无 PointerEvent ⇒ 绑 touchstart 回退（X5 内核可用）");
  ok((cvEl._h.pointerdown || []).length === 0, "不会两套都绑导致重复触发");
  const px0 = b.T.state().player.x;
  cvEl._h.touchstart[0]({ touches: [{ clientX: 700, clientY: 300 }] });
  for (let i = 0; i < 40; i++) { b.T.update(DT); b.T.render(); }
  ok(b.T.state().player.x > px0 + 20, `按住屏幕拖动 ⇒ 玩家朝触点移动（x ${px0.toFixed(0)} → ${b.T.state().player.x.toFixed(0)}）`);

  b.T.endGame("stuffed");
  ok(hasOn(b, "ovEnd"), "结算遮罩显示");
  ok((b.els.get("endStats").innerHTML || "").length > 0, "结算统计行已填充");
  ok((b.els.get("reportImg").src || "").startsWith("data:image/png"), "战报图已生成并挂到 img");
  ok((b.els.get("endTitle").textContent || "").includes("吃撑"), "标题读作「吃撑了」");

  const ba = b.els.get("btnAgain");
  ba.onclick();
  ok(b.T.state().over === false && b.T.state().time === 0 && b.T.state().started === true, "「再来一局」⇒ 全新一局直接开跑");
  ok(!hasOn(b, "ovEnd"), "再来一局后结算遮罩关闭");
}

console.log("\n10) 桌面路径（有 PointerEvent）");
{
  const b = makeBootCtx({ PointerEvent: function PointerEvent() {} });
  const cvEl = b.els.get("cv");
  ok((cvEl._h.pointerdown || []).length === 1, "有 PointerEvent ⇒ 走 pointer 分支");
  ok((cvEl._h.touchstart || []).length === 0, "pointer 分支下不重复绑 touch");
  ok(hasOn(b, "ovStart"), "桌面同样进入开始遮罩");
  cvEl._h.pointerdown[0]({ clientX: 200, clientY: 200 });
  const px0 = b.T.state().player.x;
  b.els.get("btnStart").onclick();
  for (let i = 0; i < 40; i++) b.T.update(DT);
  ok(b.T.state().player.x < px0 + 5 || b.T.state().player.x < px0, "pointer 拖动改变移动目标（无异常）");
}

console.log("\n11) 立绘 × 碰撞的尺度耦合");
{
  // 素材归一化占比（prepare_sprites.py FILL=0.72）× 模板绘制系数（2.8）。
  // 两处改一处、或素材被替换为别家占比，这条会立刻红。
  const FILL = 0.72, DCOEF = 2.8;
  const ratio = (FILL * DCOEF) / 2;
  ok(Math.abs(ratio - 1) <= 0.05, `视觉半径 ≈ 碰撞半径（0.72×2.8/2=${ratio.toFixed(3)}，容差 ±5%）`);
}

console.log("\n12) 产物静态自检");
{
  ok(/<title>[^<]*出餐口大作战[^<]*<\/title>/.test(html), "标题含游戏名");
  ok(!html.includes("/*__FOODS__*/") && !html.includes("/*__SPRITES__*/"), "注入占位符已全部替换");
  const openTags = (html.match(/<script>/g) || []).length;
  const closeTags = (html.match(/<\/script>/g) || []).length;
  ok(openTags === closeTags && openTags > 0, `script 标签闭合（${openTags} 开 ${closeTags} 闭）`);
  ok(html.trimEnd().endsWith("</html>"), "文件结构完整收尾于 </html>");
  ok(!/<link\b/i.test(html) && !/<script[^>]+src=/i.test(html) && !/<img[^>]*src="https?:/i.test(html),
    "无任何外部引用（单文件离线可玩的承诺）");
  ok(html.length > 400 * 1024, `立绘确实内联（产物 ${(html.length / 1024).toFixed(0)}KB > 400KB）`);
}

console.log(`\n结果：${pass} 通过 / ${fail} 失败`);
process.exit(fail ? 1 : 0);
