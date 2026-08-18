# dsh-okf-knowledge

[![npm](https://img.shields.io/npm/v/dsh-okf-knowledge)](https://www.npmjs.com/package/dsh-okf-knowledge)
[![license](https://img.shields.io/npm/l/dsh-okf-knowledge)](./LICENSE)

[English](./README.md) | 简体中文

为 DeepSeek Harness 提供按项目组织、可读可编辑的知识库，基于
[Open Knowledge Format (OKF) v0.2](https://github.com/GoogleCloudPlatform/knowledge-catalog/blob/main/okf/SPEC.md)。
知识是带 YAML frontmatter 的纯 Markdown——不是不可见的向量库——用户可以直接查看、审核和修改每一条知识原文。

> 请勿与 [`dsh-knowledge`](https://github.com/Soren-ABT/dsh-knowledge) 混淆：那是 RAG 路线的
> 插件（分块、向量、SQLite）；本插件把知识保留为按项目组织、可直接编辑的 OKF Markdown。
> 两者可以共存于同一个 profile——工具名、路由和 UI 入口互不冲突。

## 功能

- **按项目的 OKF bundle**：`<项目根>/.dsh/knowledge/`；另有**共享知识**
  （默认 `<dsh home>/knowledge/shared`），用于工程规范、安全规范、通用操作手册等跨项目内容。
- **对话工具**：`okf_search` / `okf_read` / `okf_validate`，
  默认只作用于当前会话所在项目（session cwd 向上最近的 `.git` 祖先）与共享知识；
  结果携带可引用的知识条目 id 与校验提示（如缺少来源）。
- **Web 入口**：侧边栏底部“知识库”按钮打开浏览与编辑面板——范围选择、目录树、
  渲染视图 + frontmatter、原文视图、编辑器；保存前 OKF 校验、保存失败展示明确错误、
  基于内容哈希的乐观锁防止并发编辑静默覆盖。
- **内置 `okf-authoring` Skill**：指导 Agent 如何拆分知识条目、填写 OKF frontmatter、
  保留来源、建立知识间链接、维护 `index.md` 与 `log.md`——仅在用户明确要求时使用。

## 安装

需要 Node.js 22.19+。安装到 DSH profile（按需替换 `web`）：

```bash
dsh plugin --profile web add dsh-okf-knowledge
```

通过 `dsh plugin add` 安装会自动激活自带的默认配置。启动前验证合成配置：

```bash
dsh --profile web --dump-config
```

## 配置

在 profile 的 `cordis.patch.yml` 中覆盖：

```yaml
- id: knowledge
  config:
    projectDir: .dsh/knowledge        # 项目 bundle 目录（相对项目根）
    sharedRoots:                      # 共享知识 bundle 根目录
      - /Users/me/.dsh/knowledge/shared
    maxResults: 8                     # okf_search 返回上限
```

## 范围与授权

范围只由可信上下文决定（R-009）：

- 工具从调用 Agent 的 session `cwd` 解析项目 bundle；模型只能用范围化 id
  （`project/<路径>`、`shared/<路径>`）访问知识，无法指定任意文件系统路径。
- Web API（`/okf-knowledge/api/*`）的项目范围来自 workspace 注册表、共享范围来自插件配置，
  仅接受 loopback 请求，并拒绝路径穿越。

## 知识格式

每条知识 = YAML frontmatter + Markdown 正文：必填 `type`；推荐 `title`、`description`；
来源 `sources` 与 `generated`（actor 约定 `human:<id>` / `<producer>/<version>` /
`process:<id>`）。保留文件：`index.md`（目录，bundle 根携带 `okf_version: "0.2"`）与
`log.md`（按日期的变更记录）。OKF 的其他字段（`verified`、`status`、`stale_after`）
和未知 frontmatter 键会被原样保留，但本插件不再解释或展示它们。

## 开发

```bash
npm install
npm run check
npm test
npm run build
```

从本地源码安装（替代 npm 正式版）：

```bash
dsh plugin --profile web add /path/to/dsh-okf-knowledge
```

## 许可证

MIT
