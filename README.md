# 世界杯小组赛实时预测比分

一个静态网页仪表盘，用于查看 2026 世界杯小组赛 A-L 组预测比分。

## 功能

- A-L 组 72 场小组赛预测比分
- 小组筛选、状态筛选、球队/盘口搜索
- 赛中手动录入分钟和当前比分后，自动修正最终预测比分
- 响应式桌面和移动端布局

## 数据口径

A 组已按 2026-06-10 公开盘口更新；B-L 组沿用当前小组报告预测，可继续按同一模型更新。

## 自动更新

网站通过 GitHub Actions 每 5 分钟更新一次 `live-data.json`，前端每 30 秒读取最新文件。

- 比分源：ESPN scoreboard，免 API Key。
- 盘口源：The Odds API，需要在 GitHub 仓库 `Settings > Secrets and variables > Actions` 中添加 `ODDS_API_KEY`。
- 可选变量：`ODDS_SPORT_KEY`，默认 `soccer_fifa_world_cup`。

没有配置 `ODDS_API_KEY` 时，网站仍会自动更新赛程/比分状态，但不会自动根据最新盘口修正预测。
