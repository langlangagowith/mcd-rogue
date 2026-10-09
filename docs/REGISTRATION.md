# 报名文案（Issue 提交用）

> 用途：在 `M-China/mcd-developer-innovation-challenge` 下发 Issue 报名。
> 入口：https://github.com/M-China/mcd-developer-innovation-challenge/issues/new
> 红线：正文 **≤1000 字**、**不得带任何图片/截图**，否则报名失败。

---

## Issue 标题（复制这一行）

```
【参赛申请】麦门开饭 McRogue —— 把「今天吃什么」变成一局 60 秒的肉鸽
```

---

## Issue 正文（复制下面代码块内的全部内容，不加图）

```text
【参赛申请】
项目名称：麦门开饭 McRogue
项目地址：https://github.com/langlangagowith/mcd-rogue
项目简介：一个基于麦当劳官方 MCP 的 WorkBuddy Skill，外加一个零门槛可玩的网页版。它不做「算完这一单」的比价工具，而是把每天最难的三个决定——早餐留不留额度、午餐用不用临期券、晚餐到店自取还是麦乐送——设计成一局三回合的肉鸽：每回合用 query-meals 抽真实菜单当手牌，用 list-nutrition-foods 做营养结算，用 calculate-price 官方核价，用 campaign-calendar 抽「今日事件」改变当天约束，把账户券当道具，用 now-time-info 判定早/正/晚时段，最后结算「省钱率 / 热量达成 / 券利用率」三项比分并生成一张可分享的战报图。核心主张：别的工具帮你算完这一单，它让你打完这一天。
所有金额与热量一律以 MCP 官方返回为准，本地只做确定性结算，不估算、不猜。结算引擎为纯函数，附 11 项单元测试；单文件网页版内置真实菜单快照（由真实菜单 × 官方营养库生成，早餐 31 张、正餐 35 张手牌），无 Token、断网也能完整玩通三关并导出战报，另有 20 项无头冒烟断言覆盖关卡贯通与战报渲染。
开发中实测打通 35 个官方 Tool，并记录了三处官方文档未载的调用细节：query-nearby-stores 在按位置搜索时 city 与 keyword 必须同时非空；query-meals 传 reservationDate 可取到早餐菜单；营养表位于 structuredContent.data 而非转义文本块。
安全与合规：不硬编码任何 Token（配置仅允许环境变量占位符），不落盘门店地址与订单等个人信息，任何下单动作都需用户显式确认，不存在静默下单路径。五份参赛必需文件齐全，官方参赛声明原样保留、未作改动。
```

---

## 提交前自检清单

| # | 检查项 | 状态 |
|:--:|---|---|
| 1 | 正文 ≤1000 字 | 见下方字数（自动统计） |
| 2 | 正文不含图片 | 纯文本，无图 |
| 3 | 三段字段齐全（【参赛申请】/项目名称/项目地址/项目简介） | ✅ |
| 4 | 项目地址可公开访问 | https://github.com/langlangagowith/mcd-rogue |
| 5 | 仓库含五份必需文件 | README.md · CONTEST_DECLARATION.md · MCP_INTEGRATION.md · 源码 · workbuddy.md |
| 6 | 仓库创建时间在活动窗口内 | 2026-10-09（窗口 2025-12-25 ~ 2026-10-25） |

---

## 提交后

报名成功后，官方机器人会在该 Issue 下回复成功通知。若失败，回复里会写明原因，改完可重新提交。
