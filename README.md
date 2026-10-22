# NEST 即时指令

NEST Instant Commands

让 AI 在回复里给你下一条带倒计时的指令：屏幕右缘出现计时药丸，锁屏和灵动岛同步倒数，超时转红色计时。你做完左滑，**用了多久、比预设快了还是慢了，AI 下一轮就知道**。

**[在线试玩 →](https://chai-and-non.pages.dev/#command)** Chai & Non 官网上的实机演示

## 本地试玩

```sh
cd demo && python3 -m http.server 8000
```

打开 http://localhost:8000 ，用「模拟 AI 推一条指令」推送，然后试手势。演示用浏览器本地存储模拟后端，不需要服务器。

## 手势

| 操作 | 效果 |
| --- | --- |
| 轻点药丸 | 展开大卡片；再点收回 |
| 上下拖 | 沿右缘移动，记住位置 |
| 左滑超过 64px | 完成 → 记录用时 |
| 长按 0.62 秒（描边充满） | 取消（不通知 AI） |
| 倒计时走完 | 不消失，转为陶土色的超时计时 |

## 目录

| 路径 | 内容 |
| --- | --- |
| `demo/command.css` `demo/command.js` `demo/index.html` | 前端组件，原样取自 NEST 生产代码；依赖 `$(id)` 和 `api(method, path)` 两个函数 |
| `demo/mock-api.js` | 演示用假后端，接真后端时删掉 |
| `server/commands.js` `server/schema.sql` | Cloudflare Workers + D1 参考实现：四个接口、标签解析、完成反馈 |
| `ios/` | 灵动岛 / 锁屏 Live Activity（SwiftUI + ActivityKit，iOS 16.1+） |

## 接入三步

1. **AI 下指令**：在系统提示里告诉模型可以写
   `<countdown>{"title":"去喝水","minutes":1}</countdown>`（不带 `minutes` 为不计时）。
   保存回复时用 `extractCountdowns(body)` 解析、`createCommands(env, items)` 落库，并把标签从展示正文里去掉。
2. **前端显示**：页面引入 `command.css`、`index.html` 里的四段组件结构和 `command.js`；`command.js` 每 15 秒轮询 `/api/commands/pending`，你也可以在推送通知到达时直接调用 `pollCommands()`。
3. **AI 知道结果**：用户下一条消息送进模型前，调用 `consumeCommandFeedback(env)`，把返回的文字拼进本轮上下文，例如：

   ```
   【指令完成反馈】
   - 「把被子叠好，拍照」用时 4 分 6 秒（比预设 180s 慢 1 分 6 秒）
   ```

   这段每轮都会变，只能放在不缓存的尾部，不要放进提示词缓存段。

## 换成你的 AI 名字

页面里设置一次即可，默认是 "AI"：

```html
<script>window.COMMAND_ISSUER = "你的 AI 名字";</script>
```

灵动岛与锁屏会显示「〈名字〉下的指令」「〈名字〉：指令内容」，完成后显示「告诉〈名字〉你做完了。」网页上的药丸和卡片本身不显示名字。

## 灵动岛（可选）

`ios/` 三个文件：

- `CommandActivityAttributes.swift`：数据契约，主 App 和 Widget Extension 都要勾选。
- `CommandActivityWidget.swift`：锁屏条、灵动岛展开 / 紧凑 / 最小四种形态，只勾 Widget Extension。
- `CommandActivityBridge.swift`：WKWebView 消息桥，只勾主 App。网页端 `command.js` 会自动调用 `window.webkit.messageHandlers.commandActivity`，没有这个桥时静默跳过。

倒计时使用 `Text(endsAt, style: .timer)`，到点后系统自动转为正向计时；`staleDate` 设为截止时刻，让系统到点重绘为超时配色。署名见上一节。

## 许可

个人非商业使用，详见 [LICENSE](LICENSE)。
