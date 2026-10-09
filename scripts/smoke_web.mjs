// 无头冒烟测试：在 Node 里用极简 DOM 桩跑一遍 web/index.html 的真实游戏逻辑。
// 用法: node scripts/smoke_web.mjs
import fs from "node:fs";
import vm from "node:vm";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const html = fs.readFileSync(path.join(ROOT, "web", "index.html"), "utf8");

const payload = html.match(/<script id="payload" type="application\/json">([\s\S]*?)<\/script>/)[1];
const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
const main = scripts[scripts.length - 1];

// ---- 极简 DOM 桩 ----
const ctx = new Proxy({}, { get: () => () => {} });
const els = new Map();
function mkEl(id) {
  return {
    id, _html: "", _text: "", onclick: null,
    style: {}, dataset: {}, width: 760, height: 1080,
    get innerHTML() { return this._html; }, set innerHTML(v) { this._html = String(v); },
    get textContent() { return this._text; }, set textContent(v) { this._text = String(v); },
    classList: { add() {}, remove() {}, contains: () => false },
    addEventListener() {}, appendChild() {}, click() {},
    getContext: () => ctx, toDataURL: () => "data:image/png;base64,",
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
const sandbox = { document, console, Math, JSON, String, Number, Object, Array, Set, Boolean };
sandbox.window = sandbox;
sandbox.globalThis = sandbox;

const probe = `
globalThis.__t = {
  get state(){ return state; },
  scoreRound, rank, cards, toggle, ROUNDS, COUPONS,
  docRef: document
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

console.log(fails === 0 ? "\n✅ 冒烟测试全部通过" : `\n❌ ${fails} 项未通过`);
process.exit(fails === 0 ? 0 : 1);
