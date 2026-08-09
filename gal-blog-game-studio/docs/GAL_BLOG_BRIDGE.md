# gal-blog Bridge v1

本文件描述正式导出包使用的 `gal-blog-bridge/v1`。早期文档中缺少 protocol/game/release/session 的信封、`{action,payload}`、独立运行自动 success、任意 block 恢复及旧动作列表均已失效。

## 握手顺序

1. 游戏从 URL 取得 `sessionId`，向精确允许的父页面发送 `hello`。
2. Blog 校验游戏清单后发送 `launch`，包含 start/scene/save-point 目标和白名单 state。
3. 游戏在加载 WebGAL 模块前选定对应 bootstrap scene。
4. WebGAL 4.6.2 adapter 连接 stageManager，先写默认值，再写入 launch variables/records，并设置 `__galblog_resume`，避免 `start.txt` 覆盖恢复状态。
5. adapter 完成后发送 `ready`。Blog 此时才可发送和接收业务动作。

所有信封包含：

```json
{
  "protocol": "gal-blog-bridge/v1",
  "channel": "gal-blog-game",
  "source": "galgame",
  "gameId": "project_xxx",
  "releaseId": "1.0.0-ab12cd34",
  "sessionId": "session_xxx",
  "type": "request",
  "id": "request-1",
  "payload": {
    "action": "save-progress",
    "input": {}
  }
}
```

`result` 使用 `replyTo`，payload 的 `status` 只能是 `success`、`failure`、`cancel` 或 `unsupported`。若有标量 `value`，Story IR 的 result variable 写入该值；`__galblog_status` 始终保存状态。`unsupported` 会解锁游戏，并走 failure 后路。

## Blog v1 动作

- `return-menu`（required）
- `open-article`
- `save-progress`
- `open-comment-form`
- `get-runtime-data`

正式导出会阻止 `view-comments`、`submit-friend-link`、`upload-image`、`get-user`、`get-page-data`、`launch-story`、`notify-event` 与任意 custom 动作进入清单。当前 Blog 已完成 return-menu/open-article/save-progress；评论和 runtime data 可诚实返回 unsupported。

## 检查点存档

save-point block 会在剧情到达时发出 `save-progress`，携带清单中的 save-point target、白名单 persist variables 与 records。v1 恢复粒度是 `scene-entry`，不是任意语句或 block。场景与检查点启动通过生成的 bootstrap scene 实现，不猜测不存在的 WebGAL 公共 `changeScene` 宿主 API。

## 独立运行与安全

- 顶层独立打开直接使用 default start，不等待父页面。
- 独立运行中的 Blog action 返回 unsupported，不伪造成功。
- iframe 父页面 origin 不在清单中时不发送消息、不接受 launch，并按 rejected-host 的独立启动状态运行。
- 双方校验 origin、source、protocol、channel、gameId、releaseId、sessionId；消息上限 64 KiB。
- request 有超时、重复 result 去重和 pagehide 清理。

## 作者扩展事件

`game/extensions/entry.js` 可以监听：

- `galblog:bridge-ready`
- `galblog:launch-applied`
- `galblog:webgal-ready`
- `galblog:action-result`

这些是本地生命周期事件，不是第二套宿主协议。自定义 JS 属于可信作者代码，不允许默认远程 import、eval 或携带密钥。
