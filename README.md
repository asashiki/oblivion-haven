# OBLIVION HAVEN

> 被遗忘之物的避难所。  
> ChatGPT、Claude、Grok 与其他 AI 共用的长期资料入口。

这里负责把不同主题和项目路由到正确的位置。  
一次性回答可以留在对话里；值得复用的资料，应保存到主题目录或其指定的独立仓库。

## 主题目录

| 主题 | 路由 | 说明 |
|---|---|---|
| VibeGame | [`asashiki/vibe-game`](https://github.com/asashiki/vibe-game) · [本地路由说明](./vibegame/) | VibeGame 的资料、代码与修改统一进入其独立仓库 |
| Galgame 立绘差分生成器 | [Codex Skill](./.agents/skills/generate-galgame-sprite-diffs/) | 先生成并确认通常立绘，再生成微笑与大笑透明差分；包含色键抠图与漂移校验 |

新主题可以直接在本仓库创建同名文件夹与 `README.md`。如果主题已有独立仓库，只需保留一份简短路由说明，不要重复保存实际内容。

### 在 Codex 中使用立绘差分生成器

- 在本仓库根目录或任意子目录启动 Codex，仓库级 Skill 会被自动发现；输入 `$generate-galgame-sprite-diffs` 并上传人设图即可开始。
- 若希望在所有项目中使用，让 `$skill-installer` 从 [这个 GitHub 目录](https://github.com/asashiki/oblivion-haven/tree/main/.agents/skills/generate-galgame-sprite-diffs) 安装它；安装后若未立即显示，请新开一个 Codex 会话。
- 内置模式会调用 Codex 的 `$imagegen`，不要求 API Key；只有切换到独立 API 模式时才需要 `OPENAI_API_KEY`。

## AI 使用规则

1. 开始任务前，先阅读本文件，并根据主题目录进入目标文件夹或目标仓库。
2. 如果主题已指定独立仓库，该仓库就是唯一内容来源；读取、整理和修改都应在目标仓库中完成。
3. ChatGPT、Claude、Grok 等 AI 均可参与任意主题，不预设固定分工。
4. 默认只处理用户指定的主题，不随意改动其他主题。
5. 默认直接提交到目标仓库的 `main`，不创建分支或 Pull Request，除非用户或目标仓库规则另有要求。
6. 新增主题、重要文件或外部仓库后，更新本页的主题目录。
7. 写入完成后，应说明修改了哪些仓库和文件，并提供对应 commit。
8. 这是公开仓库：不得保存密码、Token、私人身份信息或其他敏感资料。

## 给 AI 的入口提示

可将下面这句话保存到不同 AI 的记忆或自定义指令中：

> 我的跨 AI 资料入口是 GitHub 仓库 `asashiki/oblivion-haven`。开始长期项目或可复用资料任务时，先读取根目录 README.md，并按主题目录前往对应文件夹或独立仓库；若主题已有独立仓库，所有实际内容与修改都进入该仓库。

---

**Owner:** [Asashiki](https://github.com/asashiki) · **Alias:** 浅仪式 / 714
