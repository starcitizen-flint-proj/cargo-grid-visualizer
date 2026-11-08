# AGENTS.md

本仓库是 `sc-flint-proj` 多仓库工作区中的一个**独立仓库**。会话在本目录启动时，
上层的项目约定不会被自动加载。

**动手前先读 [`../AGENTS.md`](../AGENTS.md)。** 其中关于 venv 命名与环境、
ruff / mypy 取值、提交规范、测试规范、文档分层的约定对本仓库同样适用，此处不重复。

## 本仓库补充

- 交付形态是**纯前端、无构建**：`index.html` 双击即用，不引 Node、不引第三方依赖、
  不起本地服务。任何改动都要保持 `file://` 下可用（例如读预设走 `<script>` 而非 `fetch`）。
- 与 `playground/cargo-pack/` 的分工见 [`README.md`](README.md)：那边求最优解，这边手工摆位并出图。
- `ships.js` 是生成物，缺失时应用仍应可用；操作说明与快捷键同步更新 README。
