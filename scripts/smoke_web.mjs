// 无头冒烟测试：在 Node 里用极简 DOM 桩跑一遍 web/index.html 的真实游戏逻辑。
// 用法: node scripts/smoke_web.mjs
import fs from "node:fs";
import vm from "node:vm";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const html = fs.readFileSync(path.join(ROOT, "docs", "index.html"), "utf8");

const payload = html.match(/<script id="payload" type="application\/json">([\s\S]*?)<\/script>/)[1];
const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
const main = scripts[scripts.length - 1];

// ---- 极简 DOM 桩（canvas / Image / rAF 全套：摇餐机动画在泵帧下真跑） ----
const CTX_METHODS = ["arc", "arcTo", "beginPath", "clearRect", "closePath", "drawImage", "ellipse",
  "fill", "fillRect", "fillText", "lineTo", "moveTo", "restore", "rotate", "save", "scale",
  "setLineDash", "setTransform", "stroke", "strokeRect", "strokeText", "translate",
  "quadraticCurveTo", "bezierCurveTo", "rect", "clip"];
const grad = { addColorStop: () => {} };
const ctx2d = { measureText: () => ({ width: 10 }) };
for (const m of CTX_METHODS) ctx2d[m] = () => {};
ctx2d.createLinearGradient = () => grad;
ctx2d.createRadialGradient = () => grad;

let perf = 0;
const rafQ = [];
const flushRAF = (times = 1) => {
  for (let i = 0; i < times; i++) {
    perf += 16;
    const q = rafQ.splice(0);
    for (const fn of q) fn(perf);
  }
};

class FakeImage {
  constructor() { this.complete = false; this.naturalWidth = 0; this.naturalHeight = 0; this._src = ""; }
  set src(v) { this._src = v; this.naturalWidth = 256; this.naturalHeight = 256; this.complete = true; if (this.onload) this.onload(); }
  get src() { return this._src; }
}

const els = new Map();
function mkEl(id) {
  const s = new Set();
  return {
    id, _html: "", _text: "", onclick: null,
    style: {}, dataset: {}, width: 760, height: 1080, clientWidth: 680, clientHeight: 340,
    get innerHTML() { return this._html; }, set innerHTML(v) { this._html = String(v); },
    get textContent() { return this._text; }, set textContent(v) { this._text = String(v); },
    classList: { add(c) { s.add(c); }, remove(c) { s.delete(c); }, contains: (c) => s.has(c) },
    addEventListener() {}, appendChild() {}, click() {}, scrollIntoView() {},
    getContext: () => ctx2d, toDataURL: () => "data:image/png;base64,",
  };
}
const document = {
  getElementById(id) {
    if (!els.has(id)) {
      const e = mkEl(id);
      if (id === "payload") e.textContent = payload;   // 真实页面里数据就在这个 script 标签里
      els.set(id, e);
    }
    return els.get(id);
  },
  querySelectorAll() { return []; },
  createElement() { return mkEl("new"); },
};
const sandbox = { document, console, Math, JSON, String, Number, Object, Array, Set, Boolean,
  Image: FakeImage, performance: { now: () => perf },
  requestAnimationFrame: (fn) => { rafQ.push(fn); return rafQ.length; },
  cancelAnimationFrame: () => {},
  addEventListener: () => {},
  setTimeout: () => 0, clearTimeout: () => {} };
sandbox.window = sandbox;
sandbox.globalThis = sandbox;

const probe = `
globalThis.__t = {
  get state(){ return state; },
  scoreRound, rank, cards, toggle, ROUNDS, COUPONS,
  docRef: document,
  startShake, shareShake, drawShakeCard, showShakeCard, updateShake, drawStage,
  get shake(){ return shake; },
  SHAKE_COMBOS, SHAKE_SPRITES, SHAKE_COUPONS
};
`;

vm.createContext(sandbox);
try {
  vm.runInContext(main + "\n" + probe, sandbox, { filename: "index.html:inline" });
} catch (e) {
  console.error("❌ 脚本执行抛错：", e.message);
  process.exit(1);
}

const T = sandbox.__t;
let fails = 0;
const ok = (cond, msg) => { console.log(`${cond ? "  ✓" : "  ✗"} ${msg}`); if (!cond) fails++; };

console.log("1) 初始化");
ok(!!T.state, "state 已建立");
ok(T.state.idx === 0, `初始关卡 idx=${T.state.idx}`);
ok(T.state.results.length === 0, "初始无结算结果");
ok(T.cards().length > 0, `第 1 关手牌数 = ${T.cards().length}`);

console.log("2) 打分函数与 score.py 同口径");
const items = [{ price: 40, kcal: 300 }];
const sc = T.scoreRound(items, 10, 600);
ok(Math.abs(sc.save - 0.25) < 1e-9, `省钱率 (40-10)/40 = ${sc.save}`);
ok(Math.abs(sc.hit - 0.5) < 1e-9, `热量达成 300/600 = ${sc.hit}`);
ok(sc.cUse === 1, "用券记 1");
ok(sc.total > 0 && sc.total <= 100, `回合分在 0~100: ${sc.total}`);
const sc0 = T.scoreRound([{ price: 10, kcal: 100 }], 15, 100);
ok(sc0.paid >= 0 && sc0.save <= 1, `券额超过单点价时不产生负实付、省钱率不超 1（paid=${sc0.paid}, save=${sc0.save}）`);

console.log("3) 段位阈值");
ok(T.rank(95) === "麦门之神", "95 → 麦门之神");
ok(T.rank(45) === "麦门路人", "45 → 麦门路人");

console.log("4) 走完三关");
for (let i = 0; i < 3; i++) {
  // 每关挑一份主食里最贵的，并挂上无门槛券 —— 模拟一个正常玩家
  const pool = T.cards().filter((c) => c.cat === "主食");
  const card = (pool.length ? pool : T.cards()).reduce((a, b) => (b.price > a.price ? b : a));
  T.state.picks = [card];
  T.state.coupon = T.COUPONS[0];
  sandbox.__t.docRef.getElementById("btnServe").onclick();
  // 点"进入下一关 / 看战报"，否则关卡不会推进
  sandbox.__t.docRef.getElementById("btnNext").onclick();
}
ok(T.state.results.length === 3, `结算结果数 = ${T.state.results.length}`);
ok(T.state.idx === 2, `走完三关后停在最后一关 idx=${T.state.idx}`);
const avg = T.state.results.reduce((a, b) => a + b.total, 0) / 3;
ok(avg > 0 && avg <= 100, `平均回合分 = ${avg.toFixed(1)}`);
const labels = T.state.results.map((r) => r.round).join("/");
ok(labels === "早上/中午/晚上", `三关顺序 = ${labels}`);
T.state.results.forEach((r, i) => {
  ok(r.save >= 0 && r.save <= 1, `第 ${i + 1} 关省钱率在 0~1：${r.save}`);
  ok(r.paid >= 0, `第 ${i + 1} 关实付非负：¥${r.paid}`);
});

ok((els.get("sheetReport")?._html || "").includes("战报"), "战报面板已渲染");
ok((els.get("sheetReport")?._html || "").includes("麦门") ||
   (els.get("sheetReport")?._html || "").includes("路过"), "战报含段位");

console.log("5) 摇餐机（首屏轻玩法：摇一份 → 食材掉落 → 真券 + 分享）");
ok(T.SHAKE_COMBOS.length >= 13, `真实套餐已注入 ${T.SHAKE_COMBOS.length} 份（价格证伪过的）`);
ok(T.SHAKE_COMBOS.every((c) => c.n && c.items && c.items.length >= 2
  && c.items.every((i) => i.n && typeof i.p === "number" && i.k > 0)),
  "每份套餐有名称与 ≥2 件食材（真实价格/热量）");
ok(T.SHAKE_COMBOS.some((c) => c.save > 0), "至少一份套餐带真实省钱额（套餐价 ≤ 单点合计成立）");
ok(Object.keys(T.SHAKE_SPRITES).length >= 6, `立绘已注入 ${Object.keys(T.SHAKE_SPRITES).length} 张`);
ok(T.SHAKE_COMBOS.every((c) => c.items.every((i) => T.SHAKE_SPRITES[i.s])),
  "所有食材都有对应立绘（无空图死角）");
ok(T.SHAKE_COUPONS.length >= 3, `真券已注入 ${T.SHAKE_COUPONS.length} 张（今日优惠）`);

ok(!els.get("btnShake").classList.contains("off"), "初始：「摇一份」按钮在舞台上");
T.startShake();
ok(els.get("btnShake").classList.contains("off"), "点下去：按钮收起、开始掉落");
ok(!!T.shake && T.shake.items.length >= 2,
  `随机摇出一份 ${T.shake.items.length} 件食材的套餐：${T.shake.combo.n}`);
ok(T.shake.items.every((o) => o.img && o.img.complete), "每件食材都绑定已加载的立绘（走真实绘制路径）");
const combo = T.shake.combo;

let frames = 0;
while (frames < 500 && !(T.shake && T.shake.over)) { flushRAF(1); frames++; }
ok(T.shake.over, `掉落+庆祝动画在 ${frames} 帧内跑完（≈${((frames * 16) / 1000).toFixed(1)}s）`);
ok(!els.get("shakeCard").classList.contains("off"), "掉完自动出结果卡");
ok(els.get("scName").textContent === combo.n, `结果卡套餐名 = ${els.get("scName").textContent}`);
ok((els.get("scItems")._html || "").includes("¥"), "结果卡列出食材与分件价");
ok(els.get("scPrice").dataset.target === String(combo.p), `真实价锚定：${combo.p} 元`);
ok(els.get("scKcal").dataset.target === String(combo.k), `热量锚定：${combo.k} kcal`);
ok((els.get("scCoupons")._html || "").includes("data:image/webp"),
  "结果卡挂真券图（内联 webp，离线可见）");

flushRAF(80);
ok(els.get("scPrice").textContent === String(Math.round(combo.p * 10) / 10),
  `价格数字滚到终值 ${els.get("scPrice").textContent}`);

let threw2 = false;
try { T.shareShake(); } catch (e) { threw2 = true; console.error("   分享抛错:", e.message); }
ok(!threw2, "点「分享这份」不抛错（含分享卡绘制全路径）");
ok(els.get("maskShake").classList.contains("on"), "分享弹层已打开");
ok((els.get("sheetShake")._html || "").includes("cvShake"), "分享弹层里有分享卡 canvas");
els.get("btnCloseShake").onclick();
ok(!els.get("maskShake").classList.contains("on"), "「关掉」能收起分享弹层");

els.get("btnShakeAgain").onclick();
ok(!!T.shake && !T.shake.over && T.shake.t < 0.2, "「再摇一份」重新开始掉落（状态已重置）");

console.log(fails === 0 ? "\n✅ 冒烟测试全部通过" : `\n❌ ${fails} 项未通过`);
process.exit(fails === 0 ? 0 : 1);
