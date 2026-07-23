# WebGAL 编译器与 Terre

## 编译入口

- `compileScene(project, scene)`：增量编译单场景。
- `compileProject(project)`：生成完整文件列表、诊断与每场景脚本。
- `POST /api/story/compile`：HTTP 入口。

编译是确定性的：相同 Story IR 产生相同逻辑文件。编译器不会回写 Story IR。

## 产物

```text
index.html
gal-blog-bridge.js
gal-blog.embed.json
game/
  config.txt
  userStyleSheet.css
  animation/
    animationTable.json
    enter.json
    exit.json
    enter-from-right.json
    ...
  scene/
    start.txt
    scene_start.txt
    scene_article-archive.txt
    ...
story.project.json        # ZIP 中附带源数据
assets.required.json      # ZIP 中附带资源清单
```

`gal-blog.embed.json` 列出 Start、全部场景、存档点、路线节点和 Bridge 能力，博客不必解析 WebGAL 脚本。

## 映射

| Story IR | WebGAL |
|---|---|
| dialogue | `角色:台词 -vocal=...;` |
| narration/ADV | 无角色 `say` |
| narration/NVL | `intro:...;` |
| background | `changeBg` + `enter` / duration / easing |
| figure enter/expression/exit | `changeFigure` + 进退场预设 |
| movement | `setTransform` |
| BGM/SFX | `bgm` / `playEffect`；0–1 音量转为 0–100，BGM 支持 `-enter` 淡入淡出 |
| stage animation | `setAnimation`，可作用于舞台、背景或指定立绘 |
| choice | `choose` + `label` + `changeScene` |
| input | `getUserInput`，或固定选项与输入组合 |
| variable | `setVar` |
| condition/jump | 通用 `-when` 与 `changeScene` |
| mode | `setTextbox:hide/show` + `intro` |
| native | 原样包在可追踪注释之间 |
| save marker / AI turn | 结构化编译注释，供宿主扩展读取 |
| blog action | request token + `setVar` + 可中断 `wait` + success/failure/cancel 条件分支 |

## 资源

Story IR 保存逻辑资产 ID，编译时解析为 WebGAL 相对路径。ZIP 中的 `assets.required.json` 是复制清单。当前浏览器版只打包文本产物，不虚构二进制资源；将实际文件放入 WebGAL 的 background/figure/bgm/vocal 等目录，或由 Terre 资源上传接口管理。

## 转场与舞台动画

编译器随每个游戏包写入 WebGAL Terre 官方模板中的 `game/animation/`：

- `enter` / `exit`：透明度淡入淡出。
- `enter-from-left` / `enter-from-right` / `enter-from-bottom`：带轻微模糊的方向入场。
- `shake` / `move-front-and-back` / `blur`：常用舞台动作。
- `oldFilm`、`glitchFilm`、`rgbFilm`、`godrayFilm` 等电影滤镜。
- `shockwaveIn` / `shockwaveOut`：冲击波显现和消失。

背景与立绘的进退场使用 `changeBg` / `changeFigure` 参数；已经在舞台上的对象使用 `setAnimation`。旧项目或 AI 输入中的 `fade`、`淡入`、`淡出`会在编译边界规范化为官方 `enter` / `exit`，Story IR 仍保留用户原始局部编辑能力。

动画帧数据来源和 MPL-2.0 声明见根目录 `THIRD_PARTY_NOTICES.md`。

## WebGAL Terre

`lib/integrations/terre.ts` 使用 Terre 4.6.x 的接口：

- 健康检查与游戏列表。
- 创建游戏与场景。
- `editTextFile` 写入编译文件。
- Web 导出。
- `webgal-editor-preview-sync.v1` WebSocket，同步场景/句子并运行 snippet。

在“运行预览”填入 Terre 地址后执行同步。Studio 写入的是编译产物；源数据仍是 Story IR。

## 独立发布

两种方式：

1. 共享引擎：`sharedEngineUrl` 指向 WebGAL ESM 入口，`sharedEngineCssUrl` 指向对应样式；示例固定到官方 npm 4.6.2 构建，适合 gal-blog 统一升级。
2. 自包含引擎：把官方 WebGAL dist 放到导出根目录，并把以上两个字段改成对应的相对路径，例如 `./assets/index-*.js` 与 `./assets/index-*.css`。

生成入口包含 WebGAL 要求的 root、panic portal、首屏渲染握手和 2560×1440 响应式舞台，随后动态导入 WebGAL，并把模块导出的 Core 连接到 `gal-blog-bridge.js`。同时仍注入 `__TUANCHAT_WEBGAL__`，因此可替换成兼容团聚共创配置约定的自有 loader。

普通访客只加载静态文件，不需要运行 Terre。

## 原生指令边界

高级 WebGAL 指令可以放入 `native` 块。校验器不会假装理解其副作用，因此：

- 原生块应尽量小。
- 依赖的变量和资源仍应注册到 Story IR。
- AI 默认不能创建 `unsafe` 原生块。
- 版本升级时先对原生块做兼容检查。
