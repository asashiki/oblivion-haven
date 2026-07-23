import { strToU8, zipSync } from "fflate";

import { compileProject } from "./compiler";
import type { StoryProject } from "./types";

const thirdPartyNotices = `# Third-party notices

## WebGAL animation presets

The files under \`game/animation/\` come from the official WebGAL Terre project
template and are distributed under the Mozilla Public License 2.0.

- Source: https://github.com/OpenWebGAL/WebGAL_Terre/tree/main/packages/terre2/assets/templates/WebGAL_Template/game/animation
- License: https://github.com/OpenWebGAL/WebGAL_Terre/blob/main/LICENSE
`;

function exportReadme(project: StoryProject): string {
  return `# ${project.title}

由 Gal Blog Game Studio 从 Story IR 编译。

## 目录

- \`story.project.json\`：唯一源数据，可重新导入 Studio。
- \`game/scene/*.txt\`：WebGAL 4.6.2 编译产物。
- \`gal-blog.embed.json\`：博客 Start / Load / 路线图入口清单。
- \`gal-blog-bridge.js\`：安全 postMessage 桥接客户端。
- \`assets.required.json\`：需要复制到 WebGAL 资源目录的资源清单。
- \`game/animation/\`：随包附带的 WebGAL Terre 官方转场与舞台特效预设。

## 运行

当前入口使用 Story IR 中的 \`settings.sharedEngineUrl\` 和 \`settings.sharedEngineCssUrl\`。若要完全离线运行，请把 WebGAL 4.6.2 的 Web 构建复制到本目录，并在导出前把这两个字段改成 dist 内 ESM 与 CSS 的相对路径。

\`blog-action\` 会暂停 WebGAL 并通过 \`gal-blog-bridge.js\` 等待宿主回传；带 blog / ai target 的玩家输入会发送 \`player-input\` 消息。独立打开时 Blog Action 自动按 success 继续，方便离线试玩。

资源应按 WebGAL 目录放置：

- 背景 → \`game/background/\`
- 立绘 / 表情 → \`game/figure/\`
- BGM → \`game/bgm/\`
- 语音 → \`game/vocal/\`
- 音效 → \`game/video/\` 或项目约定目录

编译器不会静默忽略缺失引用；导出前请在 Studio 的“问题”面板清零错误。
`;
}

export function createProjectZip(project: StoryProject): Blob {
  const compiled = compileProject(project);
  const entries: Record<string, Uint8Array> = {};
  compiled.files.forEach((file) => {
    entries[file.path] = strToU8(file.content);
  });
  entries["story.project.json"] = strToU8(`${JSON.stringify(project, null, 2)}\n`);
  entries["assets.required.json"] = strToU8(`${JSON.stringify(project.assets.map((asset) => ({
    id: asset.id,
    kind: asset.kind,
    name: asset.name,
    sourcePath: asset.path,
    aliases: asset.aliases,
    missing: asset.missing ?? false,
  })), null, 2)}\n`);
  entries["README.md"] = strToU8(exportReadme(project));
  entries["THIRD_PARTY_NOTICES.md"] = strToU8(thirdPartyNotices);
  const zipped = zipSync(entries, { level: 6 });
  const buffer = zipped.buffer.slice(zipped.byteOffset, zipped.byteOffset + zipped.byteLength) as ArrayBuffer;
  return new Blob([buffer], { type: "application/zip" });
}

export function createStoryJson(project: StoryProject): Blob {
  return new Blob([`${JSON.stringify(project, null, 2)}\n`], { type: "application/json" });
}
