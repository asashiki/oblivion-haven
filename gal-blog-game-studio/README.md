# Gal Blog Game Studio

面向 gal-blog 的 AI 优先 Galgame 创作、编排与发布系统。项目把 **Story IR 1.0** 作为唯一源数据，把 WebGAL 4.6.2 脚本与 Web 游戏包视为可重复生成的编译产物。人类编辑、AI 工具调用、AI 剧本导入和运行时生成都修改同一份 Story IR。

[在线体验 Gal Blog Game Studio](https://gal-blog-game-studio.asashiki-5352.chatgpt.site)

第一版已经提供可运行的编辑器、全类型剧情块表单、角色与表情差分、资源与别名管理、项目/引擎/Bridge 设置、作者/玩家双视图叙事地图、ADV/NVL 预览、多格式与混合格式导入、Patch 撤销重做、WebGAL 编译、ZIP 导出、Terre 同步、受约束 AI 工具 API 和安全 Blog Bridge。

当前版本额外完成了两条实际发布链路：

- 叙事地图采用类似《月姬》路线图的纵向结构：故事沿主轴自上而下推进，同层分支向左右展开；支持一键自动竖排、自由拖动、重新连线、分支条件编辑，以及右侧场景摘要。
- 导出包直接附带 WebGAL Terre 官方的淡入、淡出、方向入场、震动、推近、电影滤镜与冲击波预设。Studio 会把友好的 `fade` 别名、BGM 淡入淡出和 0–1 音量正确编译为 WebGAL 指令，不需要重新实现动画引擎。

## 当前素材边界

仓库没有附带未提交的 BGM、背景图、语音或人物表情立绘；示例工程保留资源注册、别名、缺失诊断与替换入口。转场、渐入渐出、方向入场、震动和滤镜等通用演出则随编译器提供，可直接写入导出的 WebGAL 工程。

当前验收基线为 22 项核心 Story/编译/Bridge/导出/API 测试全通过，并通过 TypeScript、ESLint、生产构建、渲染测试与浏览器冷启动回归。

## 本地启动

要求 Node.js `>=22.13.0`。

```bash
npm ci
npm run dev
```

打开终端显示的本地地址。生产构建与验证：

```bash
npm run build
npm test
```

类型与代码质量检查：

```bash
npx tsc --noEmit
npm run lint
```

## 核心工作流

1. 在“剧本”中以剧情块精确编辑场景，或切换到 AI / Ren'Py-like 代码视图。
2. 在“AI 创作”中粘贴 JSON、Markdown、Ren'Py-like、WebGAL、标签式或自然语言剧本。
3. 解析器先解析资源别名并生成 Story IR；不存在的角色、表情或资源会产生诊断，不会静默写入坏路径。
4. 在“叙事地图”中以竖向主轴连接公共线、角色线、场景故事、条件节点与多个结局；点击“自动竖排”可根据有向分支重新整理。
5. 在“运行预览”使用内建 Story IR 模拟器，或连接本地 WebGAL Terre 实例同步真实 WebGAL 工程。
6. 在“编译与导出”检查 WebGAL 文件、下载 `story.project.json` 或完整 Web ZIP。

## 目录

```text
app/
  api/                    Story 编译、Patch、AI 工具 API
components/studio/        编辑器、叙事地图、运行预览
lib/story/                Story IR、校验、导入、Patch、编译、运行时
lib/integrations/         Terre 客户端与 gal-blog Bridge
docs/                     架构、协议、格式和状态说明
examples/import/          多种 AI 输入与 Patch 示例
```

关键文档：

- [系统架构](docs/ARCHITECTURE.md)
- [Story Model / Story IR](docs/STORY_MODEL.md)
- [AI 导入、Patch 与工具 API](docs/AI_IMPORT_AND_TOOLS.md)
- [WebGAL 编译器与 Terre](docs/WEBGAL_COMPILER.md)
- [gal-blog Bridge 与嵌入](docs/GAL_BLOG_BRIDGE.md)
- [已实现与待实现状态](docs/STATUS.md)

## API

- `GET /api/example-project`：完整示例 Story IR。
- `POST /api/story/compile`：编译整个项目或单个场景。
- `POST /api/story/patch`：应用可逆 StoryPatch。
- `GET /api/ai-tools`：AI 工具目录。
- `POST /api/ai-tools`：执行一个受约束工具调用并返回项目、正向操作与逆向操作。

## WebGAL / Terre

导出包按 WebGAL 工程结构生成 `game/config.txt`、`game/scene/start.txt`、各场景脚本与完整 `game/animation/`，不重写 WebGAL 引擎。示例项目锁定官方 `webgal-engine@4.6.2` 共享模块；`sharedEngineUrl` / `sharedEngineCssUrl` 也可改为部署包内的官方 dist 相对路径，得到不依赖编辑服务的自包含静态游戏。

导出的 `gal-blog-bridge.js` 会订阅 WebGAL 舞台变量。`blog-action` 在引擎中暂停，等待博客回传 success / failure / cancel，写回 Story 变量后再继续或跳转；带 `blog` / `ai` target 的自由输入会发出 `player-input` 消息与同名浏览器事件。

若本地运行 WebGAL Terre，在项目设置中指定 `terreBaseUrl`。Studio 会复用 Terre 的工程创建、文本文件写入、导出路由与 `webgal-editor-preview-sync.v1` WebSocket 预览协议。

## 数据与安全

- 浏览器自动保存只是编辑体验；下载的 `story.project.json` 才是可移植源文件。
- AI provider 未绑定到特定厂商。后端应把模型输出限制为 `/api/ai-tools` 工具调用或 `/api/story/patch` 操作。
- Blog Bridge 默认校验 `allowedOrigins`、`channel`、请求 ID 和超时。生产环境不要使用通配来源。
- 资源注册记录路径和别名；第一版不会替你托管二进制素材，导出前仍应把实际资源文件复制到 WebGAL 对应目录。

## 上游边界

本项目复用而不改写 WebGAL 的运行能力，并针对以下上游接口保持适配层：

- OpenWebGAL/WebGAL：最终运行与发布目标。
- OpenWebGAL/WebGAL_Terre：工程、资源、脚本、预览与导出后端。
- starrybamboo/tuan-chat-web：实时消息编译、场景增量写入、预览同步、工作流与共享 loader 思路。
- LetGal：仅参考其 Ren'Py-like 视图、Block 源数据、可视化叙事地图与历史快照交互，不依赖闭源实现。

许可证与上游代码版权按各自仓库声明执行。导出所需的 WebGAL 官方动画 JSON 来自 WebGAL Terre 模板，按 MPL-2.0 保留来源说明，详见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)；其他部分没有复制上游的大段业务源码，而是实现兼容适配层。
