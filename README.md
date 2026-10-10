<div align="center">

# 麦门开饭 · McRogue

**把「今天吃什么」变成一局 60 秒的肉鸽。**

用你附近门店**真实的菜单、真实的券、真实的核价**，
打完一日三餐，结算出一张可以晒的战报。

麦当劳程序员创意开发大赛参赛作品 · 非麦当劳官方产品

</div>

---

## 这是什么

一个基于**麦当劳中国 MCP** 的 WorkBuddy Skill，外加一个**不用装任何东西就能玩的网页版**。

它把每天最难的决定——「这顿吃什么、怎么点最划算、能不能顺手用掉快过期的券」——设计成一局有三回合的小游戏：

| 回合 | 对应 | 你要做的选择 |
|:---:|---|---|
| ① 早上 | 早餐 | 预算优先，还是留额度给午餐？ |
| ② 中午 | 正餐 | 用掉临期券，还是留到晚上？ |
| ③ 晚上 | 晚餐 | 到店自取省配送费，还是叫麦乐送？ |

每回合会抽一个**今日事件**（当月活动、联名、加价购……），改变这一天的约束。
三回合打完，结算 **省钱率 / 热量达成 / 券利用率**，生成一张战报。

> 核心主张：**别的工具帮你「算完这一单」，它让你「打完这一天」。**

**目标用户**：预算和午休时间都有限的上班族与学生——每天要在一分钟内决定「吃什么、怎么点最划算」；
也包括手握临期券、想顺手尝新品的麦当劳常客。

---

## 30 秒上手

> 🎮 **就想直接玩？** 除了下面这套「三回合点餐」，仓库里还有两个单文件小游戏：
> - [**麦门幸存者 McSurvivor**](./docs/neon.html) —— 幸存者类：自动开火 + 走位 + 三选一构筑，
>   敌人的血量与速度由真实营养数据派生；
> - [**出餐口大作战 McChow**](./docs/arcade.html) —— 接住出料口倒下来的真实菜单（吃撑结束），
>   12 张手绘风餐品立绘，热量越高体型越大；掉落的**优惠券是麦当劳此刻真实在发的券**，
>   开始页会展示**今天的真实活动海报**。
>
> 在线玩：**https://langlangagowith.github.io/mcd-rogue/** ·
> [/neon.html](https://langlangagowith.github.io/mcd-rogue/neon.html) ·
> [/arcade.html](https://langlangagowith.github.io/mcd-rogue/arcade.html)
>
> 🗓 **每日挑战**：两个小游戏都是「种子 = 今天的日期」——同一天所有人玩到的是同一局
> （同出料、同券、同怪），把链接 `?d=YYYYMMDD` 发给朋友就能同题比分数。

### 方式一：直接玩（无需任何配置）

打开 [`docs/index.html`](./docs/index.html) —— **单文件、离线可玩**，
或直接玩在线版：**https://langlangagowith.github.io/mcd-rogue/**
数据已内嵌（真实菜单 + 官方营养库 + 当季活动），不用 Token、不联网也能完整玩一局，
打完可以导出一张可分享的战报图。

> 注：网页版里的「券」是**演示券**（真实券为账户私有，无法内置）；
> 在 WorkBuddy 中运行时，券来自 MCP 的 `auto-bind-coupons` / `query-my-coupons`。

### 方式二：在 WorkBuddy 里跑真实数据

1. 到 [麦当劳 MCP 开放平台](https://open.mcd.cn/mcp) 用手机号登录，在「控制台」激活并复制 **MCP Token**；
2. WorkBuddy → 左侧【专家·技能·连接器】→【连接器】→右上角【自定义连接器】→【配置 MCP】，粘贴 [`mcp-config.example.json`](./mcp-config.example.json) 里的配置，把 `YOUR_MCP_TOKEN` 换成你的 Token；
3. 启用 `mcd-mcp`，然后把 [`SKILL.md`](./SKILL.md) 拖进对话框；
4. 说一句：**「麦门开饭，开一局」**。

详细图文步骤见 [`docs/DESIGN.md`](./docs/DESIGN.md)。

---

## 它真实调用了哪些 MCP 能力

见 [`MCP_INTEGRATION.md`](./MCP_INTEGRATION.md)。用到的官方 Tool（来自 `mcd-mcp`）：

| 用途 | Tool |
|---|---|
| 时段判定（早/正/晚） | `now-time-info` |
| 定位门店 | `query-nearby-stores` |
| 抽「手牌」 | `query-meals` · `query-meal-detail` |
| 营养结算 | `list-nutrition-foods` |
| 券（道具） | `available-coupons` · `auto-bind-coupons` · `query-my-coupons` · `query-store-coupons` |
| 真实核价 | `calculate-price` |
| 今日事件 | `campaign-calendar` |
| 积分（成就） | `query-my-account` |
| 可选：真的下单 | `create-order` · `query-order` · `cancel-order` |

**所有金额与热量都以 MCP 官方返回为准**，本地只做确定性结算，不估算、不猜。

---

## 设计文档

- 玩法与数据流：[`docs/DESIGN.md`](./docs/DESIGN.md)
- 仓库文件清单与提交要求：[`docs/DESIGN.md#仓库结构`](./docs/DESIGN.md)

---

## 安全与隐私

- **不硬编码任何 Token**：配置文件只允许 `${MCD_MCP_TOKEN}` 环境变量占位符；
- **不落盘个人信息**：门店地址、订单、手机号一律不写入仓库；
- **写入类操作有三段式确认闸门**：任何 `create-order` 都必须先由用户显式确认，不存在静默下单路径。

---

## 许可

代码以 [MIT](./LICENSE) 开源。麦当劳相关名称、餐品与数据版权归其权利人所有，本项目仅用于接口调用与演示。

> 本项目输出仅供参考，不构成医疗、营养或其他专业建议；餐品信息、价格及供应状态以麦当劳官方渠道的实时结果为准。
