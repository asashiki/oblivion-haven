# TTS 剧本标注规范 v0.1

## 目的

用于视觉小说剧本的配音生产。保存角色的表演意图，不绑定具体 TTS 服务。

适用：Fish Audio、MiniMax 等。

## 核心原则

剧本文本和 TTS 标注分离。

游戏显示：

```text
ご主人様、また新しいものを作ってるんですか？
```

内部标注：

```yaml
delivery: gentle_exasperated
```

不要在剧本阶段写 Fish/MiniMax 专用 prompt 或 API 参数。

## Take

剧本按句保存，但 TTS 优先按连续表演段生成。

推荐：

- 同一角色
- 同一情绪范围
- 2～6 句
- 十几秒以内

生成后根据时间戳切回单句音频。

## 数据结构

```yaml
take_id: alice_scene_01
speaker: alice
default_delivery: gentle
lines:
  - id: l001
    text_ja: "ご主人様ですか？"
  - id: l002
    text_ja: "ひと言で言うなら……"
    pause_after: short
```

## Delivery 标签

第一版控制在少量：

- gentle
- light_cheerful
- light_tease
- dry_tease
- gentle_exasperated
- embarrassed
- surprised
- protective
- serious_soft
- deadpan

不要过度标注。

## 停顿

使用抽象标签：

- micro
- short
- medium
- long

标点本身也是表演的一部分，不要随意改动「……」等节奏信息。

## 非语言动作

可选：

- sigh
- soft_laugh
- chuckle
- breath
- hesitate

少用。

## 供应商适配

剧本保存通用 delivery。

后续由适配层转换为 Fish Audio 或 MiniMax 所需格式。

不要在剧本文件中保存：

- temperature
- speed
- pitch
- API 请求参数
