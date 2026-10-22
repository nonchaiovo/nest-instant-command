//
//  CommandActivityBridge.swift
//  即时指令倒计时 · 主 app 端启停 Live Activity
//
//  Target Membership: 只勾主 App target（不勾 Widget Extension）
//
//  JS ↔ Swift 桥（模式同 SealedActivityBridge）。同一时间只有一条指令在跑（chat.html CURRENT_COMMAND）。
//
//  JS 用法：
//    window.webkit.messageHandlers.commandActivity.postMessage({
//      type: "start", commandId: 7, title: "安静读 25 分钟",
//      startedAtMs: 1717000000000, countdownSeconds: 1500, issuedBy: "AI",
//    });
//    window.webkit.messageHandlers.commandActivity.postMessage({ type: "done", commandId: 7 });
//    window.webkit.messageHandlers.commandActivity.postMessage({ type: "end",  commandId: 7 });
//

import Foundation
import WebKit
#if canImport(ActivityKit)
import ActivityKit
#endif

@MainActor
class CommandActivityBridge: NSObject, WKScriptMessageHandler {

    private var currentActivity: Any?
    private var currentCommandId: Int?
    // 缓存最后一次 ContentState —— markDone 时复用（避免读 act.content 需要 16.2）
    private var currentStateBox: Any?

    func install(on webView: WKWebView) {
        webView.configuration.userContentController.add(self, name: "commandActivity")
    }

    func userContentController(_ userContentController: WKUserContentController,
                               didReceive message: WKScriptMessage) {
        guard let dict = message.body as? [String: Any],
              let type = dict["type"] as? String else { return }

        if #available(iOS 16.1, *) {
            switch type {
            case "start":
                guard let commandId = intOf(dict["commandId"]) else { return }
                let title = (dict["title"] as? String) ?? ""
                let issuedBy = (dict["issuedBy"] as? String) ?? "AI"
                let startedAtMs = (dict["startedAtMs"] as? Double) ?? Date().timeIntervalSince1970 * 1000
                let countdownSeconds = (dict["countdownSeconds"] as? Double) ?? 0
                self.startActivity(commandId: commandId, title: title, issuedBy: issuedBy,
                                   startedAtMs: startedAtMs, countdownSeconds: countdownSeconds)
            case "done":
                guard let commandId = intOf(dict["commandId"]) else { return }
                self.markDone(commandId: commandId)
            case "end":
                guard let commandId = intOf(dict["commandId"]) else { return }
                self.endActivity(commandId: commandId)
            default:
                break
            }
        }
    }

    private func intOf(_ v: Any?) -> Int? {
        if let i = v as? Int { return i }
        if let d = v as? Double { return Int(d) }
        return nil
    }

    @available(iOS 16.1, *)
    private func startActivity(commandId: Int, title: String, issuedBy: String,
                               startedAtMs: Double, countdownSeconds: Double) {
        let startedAt = Date(timeIntervalSince1970: startedAtMs / 1000.0)
        let hasCountdown = countdownSeconds > 0
        let endsAt = hasCountdown ? startedAt.addingTimeInterval(countdownSeconds) : startedAt
        let state = CommandActivityAttributes.ContentState(
            startedAt: startedAt, endsAt: endsAt, hasCountdown: hasCountdown,
            title: title, isDone: false
        )

        // app 被杀后重开，内存引用丢了但系统 Activity 还活着——复用同 commandId 的，清掉其他过期的
        for activity in Activity<CommandActivityAttributes>.activities {
            if activity.attributes.commandId == commandId && activity.attributes.issuedBy == issuedBy {
                self.currentActivity = activity
                self.currentCommandId = commandId
                self.currentStateBox = state
                Task {
                    if #available(iOS 16.2, *) {
                        let stale = hasCountdown ? endsAt : startedAt.addingTimeInterval(60 * 60 * 4)
                        await activity.update(ActivityContent(state: state, staleDate: stale))
                    } else {
                        await activity.update(using: state)
                    }
                }
                print("[CommandActivity] restored cmd=\(commandId)")
                return
            }
            Task {
                if #available(iOS 16.2, *) { await activity.end(nil, dismissalPolicy: .immediate) }
                else { await activity.end(dismissalPolicy: .immediate) }
            }
        }

        // 先结掉旧的（同一时间一条指令）
        if let existing = self.currentActivity as? Activity<CommandActivityAttributes> {
            Task {
                if #available(iOS 16.2, *) { await existing.end(nil, dismissalPolicy: .immediate) }
                else { await existing.end(dismissalPolicy: .immediate) }
            }
            self.currentActivity = nil
            self.currentCommandId = nil
        }

        guard ActivityAuthorizationInfo().areActivitiesEnabled else {
            print("[CommandActivity] Live Activities not enabled")
            return
        }

        let attrs = CommandActivityAttributes(commandId: commandId, issuedBy: issuedBy)

        do {
            if #available(iOS 16.2, *) {
                let stale = hasCountdown ? endsAt : startedAt.addingTimeInterval(60 * 60 * 4)
                let content = ActivityContent(state: state, staleDate: stale)
                let act = try Activity<CommandActivityAttributes>.request(attributes: attrs, content: content, pushType: nil)
                self.currentActivity = act
            } else {
                let act = try Activity<CommandActivityAttributes>.request(attributes: attrs, contentState: state, pushType: nil)
                self.currentActivity = act
            }
            self.currentCommandId = commandId
            self.currentStateBox = state
            print("[CommandActivity] started cmd=\(commandId) countdown=\(hasCountdown)")
        } catch {
            print("[CommandActivity] start failed: \(error)")
        }
    }

    @available(iOS 16.1, *)
    private func markDone(commandId: Int) {
        guard self.currentCommandId == commandId,
              let act = self.currentActivity as? Activity<CommandActivityAttributes>,
              let old = self.currentStateBox as? CommandActivityAttributes.ContentState else { return }
        let newState = CommandActivityAttributes.ContentState(
            startedAt: old.startedAt, endsAt: old.endsAt, hasCountdown: old.hasCountdown,
            title: old.title, isDone: true
        )
        self.currentStateBox = newState
        Task {
            if #available(iOS 16.2, *) {
                let content = ActivityContent(state: newState, staleDate: Date().addingTimeInterval(60 * 5))
                await act.update(content)
            } else {
                await act.update(using: newState)
            }
            // "指令完成"短暂停留 6 秒后自动撤
            try? await Task.sleep(nanoseconds: 6 * 1_000_000_000)
            if #available(iOS 16.2, *) { await act.end(nil, dismissalPolicy: .immediate) }
            else { await act.end(dismissalPolicy: .immediate) }
            await MainActor.run {
                if (self.currentActivity as AnyObject?) === (act as AnyObject) {
                    self.currentActivity = nil
                    self.currentCommandId = nil
                }
            }
        }
        print("[CommandActivity] marked done cmd=\(commandId)")
    }

    @available(iOS 16.1, *)
    private func endActivity(commandId: Int) {
        guard self.currentCommandId == commandId,
              let act = self.currentActivity as? Activity<CommandActivityAttributes> else { return }
        Task {
            if #available(iOS 16.2, *) { await act.end(nil, dismissalPolicy: .immediate) }
            else { await act.end(dismissalPolicy: .immediate) }
        }
        self.currentActivity = nil
        self.currentCommandId = nil
        print("[CommandActivity] ended cmd=\(commandId)")
    }
}
