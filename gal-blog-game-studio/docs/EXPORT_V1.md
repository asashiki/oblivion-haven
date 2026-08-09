# 正式导出 v1

普通界面右上角“导出”生成两个互相独立的产物。

## 正式可玩包

文件名：`<slug>-<version>-<hash8>-runtime.zip`。ZIP 根目录就是静态部署目录：

```text
index.html
boot.js
gal-blog-runtime.js
gal-blog-bridge.js
gal-blog.embed.json
integrity.json
README.md
THIRD_PARTY_NOTICES.md
vendor/webgal/
game/config.txt
game/userStyleSheet.css
game/theme.tokens.json
game/template/
game/extensions/entry.js
game/animation/
game/scene/
game/background/
game/figure/
game/bgm/
game/vocal/
game/video/
```

WebGAL 运行时来自精确依赖 `webgal-engine@4.6.2`。构建脚本收集其完整非预压 dist、许可证并生成带 SHA-256 的 runtime manifest；浏览器导出只从 Studio 同源读取这些文件，不访问 npm/CDN。只有剧本实际引用的素材会写入公开包，任一引用读取失败会阻止导出。

`gal-blog.embed.json` 直接符合 Blog 的 `gal-blog-game-package/v1`：包含 start、作者明确标记 replayable 的 scene、scene-entry save-point、安全公开路线、状态白名单、精确 origins 与 integrity 路径。路线不会泄露条件、作者备注或编辑坐标。

## 工程备份

文件名：`<slug>-<version>-project.json`。它保存可重新导入的 Story IR，并递归移除 apiKey/token/secret/password/authorization 等密钥字段。公开 runtime ZIP 不含 Story IR、素材源路径清单或 AI 配置密钥。

## releaseId 与 integrity

releaseId 是 `<gameVersion>-<hash8>`。hash 输入由以下内容按安全路径稳定排序后计算：

- 标准化的 manifest seed（不含 releaseId）；
- 固定 runtime 和 runtime manifest；
- WebGAL 场景、配置与动画；
- 实际引用素材；
- CSS、template、extension；
- index 与 Bridge 的无循环占位版本。

不包含导出时间。同一输入重复导出得到同一 releaseId；剧情、素材、CSS、扩展、Bridge 或 runtime 变化都会产生新 ID。最终 manifest 写入 releaseId 后，对除 `integrity.json` 自身外的每个文件计算 SHA-256，生成 `gal-blog-integrity/v1`。

## 本地与 Blog 使用

不承诺 `file://`。解压后运行任意静态服务器：

```bash
python -m http.server 8000
```

Blog 将目录放入 `public/games/<slug>/<releaseId>/`，release registry 只需登记 slug、releaseId 与对应目录。Blog 当前无需自行复制或下载 WebGAL 引擎。

手工修改公开包会使 releaseId 和 integrity 失效，应回 Studio 重新导出新 release，不要覆盖已发布版本。
