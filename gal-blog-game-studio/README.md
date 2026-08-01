# Gal Blog Game Studio

面向 gal-blog 的 Galgame 创作、编排与发布工作台。目标体验是由 AI 承担素材选择与演出编排，但当前版本尚未接入真实模型 Provider；界面中的自动草稿与修订均明确标注为“本地规则（非 AI）”。Story IR、变量、WebGAL 指令和导出参数留在后台或“高级模式”中。

当前内置项目不是虚构资源堆出来的演示库。它只登记用户实际提供的三份素材：爱丽丝标准立绘、爱丽丝 Q 版立绘和白昼茶室背景。BGM、语音、音效以及其他表情没有文件，因此保持为空。

发布验收样章不是再手写到默认数据中。`scripts/generate-ai-acceptance.ts` 从空章节开始，通过生产环境同一套 AI 工具 API 创建四个片段、对白、选择、分支与回环，并把生成结果和完整调用记录分别固化为 `generatedAcceptance.json` 与测试夹具。它由本轮 ChatGPT 充当模型执行，不能被误解为站内模型 Provider 已经接通。

项目把 **Story IR 1.0** 作为唯一源数据，把 WebGAL 4.6.2 脚本与 Web 游戏包视为可重复生成的编译产物。简单模式、专业编辑器、工具调用、导入器和实机预览修改的是同一个项目，不存在“简单项目”和“高级项目”两套不兼容数据。

## 默认的三步创作

1. **素材库**：可先不上传文件，先在素材助理里说明角色包、命名习惯和用途；点名已有素材时，确定性整理会形成一笔可撤销操作。支持普通文件与含 README、inventory、`webgal-manifest.json` 的完整立绘 ZIP，素材名和角色名可直接复制。角色图会扫描透明像素边界并给出默认构图，可直接拖动、缩放或切换左／中／右与胸像／腰上／膝上／全身。17 个 WebGAL Terre 常用转场、运动和滤镜作为内置演出库供 AI 调用，不要求用户补传。
2. **故事地图**：按章节纵向组织完整可玩的“小片段”，外层可交叉细线只表示片段结束后的主干。选中片段后，右侧按真实播放顺序编辑片段内的选项组；每个选项可继续、跳到本段或别段的任意选项组、结束片段，或写入一次性记录。外层细线支持“拥有全部记录”与“一组记录至少 N 个”的进入条件。
3. **实机试玩**：点击任意片段后，Studio 会即时编译当前 Story IR，并在 iframe 中运行官方 WebGAL 4.6.2。逐句编辑区可展开任意对白；角色、表情、站位、缩放与纵向位置都属于这一句。选项组后的第一句可按每个“继续”选项设置不同台词或立绘反应，随后自动汇合。编辑区、地图侧栏和素材详情栏都可拖动调整宽度。

一个片段内部可以有多组选项、条件、短反应和返回循环。内部循环会编译成选项组标签与跳转，不会被拆成外层地图上的几十个节点；简单模式不再混入玩家地图视图。

“高级模式”完整保留全类型剧情块表单、WebGAL 代码、多格式导入、变量、校验、Terre、Blog Bridge 和编译导出，供需要精确控制时使用。

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

1. 在“素材库”上传素材，检查自动推断的类型与基础说明。
2. 在“故事地图”新增一个片段，写下这一小段发生什么。
3. 在当前版本可选择运行“本地规则草稿（非 AI）”，或进入高级模式精确编辑；没有 BGM 时项目保持静音。
4. 切到“试玩修订”，使用官方 WebGAL 实机检查立绘构图、转场、点击和选项。
5. 需要精确处理变量、WebGAL 指令或发布设置时再进入“高级模式”。
6. 在高级模式的“编译与导出”下载 `story.project.json` 或完整 Web ZIP。

## 目录

```text
app/
  api/                    Story 编译、Patch、AI 工具 API
components/studio/        编辑器、叙事地图、WebGAL 实机预览
lib/story/                Story IR、本地规则草稿、校验、导入、Patch、编译、运行时
lib/webgalPreview.ts      浏览器内编译与 WebGAL 虚拟预览文件系统
lib/integrations/         Terre 客户端与 gal-blog Bridge
lib/localAssetStore.ts    浏览器本地素材文件存储
docs/                     架构、协议、格式和状态说明
```

关键文档：

- [系统架构](docs/ARCHITECTURE.md)
- [Story Model / Story IR](docs/STORY_MODEL.md)
- [AI 导入、Patch 与工具 API](docs/AI_IMPORT_AND_TOOLS.md)
- [WebGAL 编译器与 Terre](docs/WEBGAL_COMPILER.md)
- [gal-blog Bridge 与嵌入](docs/GAL_BLOG_BRIDGE.md)
- [已实现与待实现状态](docs/STATUS.md)

## API

- `GET /api/example-project`：由生产 AI 工具链生成、只含三份真实素材的四片段验收 Story IR。
- `POST /api/story/compile`：编译整个项目或单个场景。
- `POST /api/story/patch`：应用可逆 StoryPatch。
- `GET /api/ai-tools`：AI 工具目录。
- `POST /api/ai-tools`：执行一个受约束工具调用并返回项目、正向操作与逆向操作。

## WebGAL / Terre

导出包按 WebGAL 工程结构生成 `game/config.txt`、`game/scene/start.txt`、各场景脚本与完整 `game/animation/`，不重写 WebGAL 引擎。Studio 的默认试玩也运行同一份编译产物，而不是另画一套“像 Galgame 的”占位 UI。示例项目锁定官方 `webgal-engine@4.6.2` 共享模块；`sharedEngineUrl` / `sharedEngineCssUrl` 也可改为部署包内的官方 dist 相对路径。

导出的 `gal-blog-bridge.js` 会订阅 WebGAL 舞台变量。`blog-action` 在引擎中暂停，等待博客回传 success / failure / cancel，写回 Story 变量后再继续或跳转；带 `blog` / `ai` target 的自由输入会发出 `player-input` 消息与同名浏览器事件。

若本地运行 WebGAL Terre，在项目设置中指定 `terreBaseUrl`。Studio 会复用 Terre 的工程创建、文本文件写入、导出路由与 `webgal-editor-preview-sync.v1` WebSocket 预览协议。

## 数据与安全

- 浏览器自动保存只是编辑体验；下载的 `story.project.json` 才是可移植源文件。
- 内置三份素材作为静态项目文件随站点提供；后来上传的素材文件保存在当前浏览器的 IndexedDB，资源说明和路径进入 Story IR。跨设备或正式发布仍应接入对象存储，或把实际文件复制进 WebGAL 资源目录。
- 当前只有可离线验证的确定性导演规则，不是 AI。真实模型 Provider、联网推理与密钥服务尚未接入；接入后仍应把模型输出限制为导演草稿、`/api/ai-tools` 工具调用或 `/api/story/patch` 操作。
- Blog Bridge 默认校验 `allowedOrigins`、`channel`、请求 ID 和超时。生产环境不要使用通配来源。
- Web ZIP 会读取 IndexedDB 中的真实素材二进制并写入 WebGAL 工程；任一素材读取失败会阻止导出并列出缺失项，不会只生成清单冒充完整游戏包。

## 上游边界

本项目复用而不改写 WebGAL 的运行能力，并针对以下上游接口保持适配层：

- OpenWebGAL/WebGAL：最终运行与发布目标。
- OpenWebGAL/WebGAL_Terre：工程、资源、脚本、预览与导出后端。
- starrybamboo/tuan-chat-web：实时消息编译、场景增量写入、预览同步、工作流与共享 loader 思路。
- LetGal：仅参考其 Ren'Py-like 视图、Block 源数据、可视化叙事地图与历史快照交互，不依赖闭源实现。

许可证与上游代码版权按各自仓库声明执行。导出所需的 WebGAL 官方动画 JSON 来自 WebGAL Terre 模板，按 MPL-2.0 保留来源说明，详见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)；其他部分没有复制上游的大段业务源码，而是实现兼容适配层。
