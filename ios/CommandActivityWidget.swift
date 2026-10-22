//
//  CommandActivityWidget.swift
//  即时指令进行中 · Widget Extension UI
//
//  Target Membership: 只勾 Widget Extension target（不能勾主 app）
//
//  覆盖 4 个呈现位：
//   1. 锁屏 / 通知中心条：闪电 badge + "即时指令进行中" + "AI：内容" + 剩余 + 进度条
//   2. 灵动岛 expanded：闪电 + "AI 下的指令" / 内容 + 大号倒计时 + 进度条
//   3. compactLeading（闪电）+ compactTrailing（剩余 mm:ss）
//   4. minimal（闪电）
//  done 态：闪电 → 勾，"指令完成"。
//
//  色板：AI 橙 #E2A28F · cream #EDE6D4。
//

import SwiftUI
import WidgetKit
import ActivityKit

// ── glyph：闪电（boltFill）/ 勾（check），移植自 island-kit.js ──
@available(iOS 16.1, *)
struct BoltGlyph: View {
    let size: CGFloat
    let color: Color
    var body: some View {
        let s = size / 14.0
        // M8 1 L3 7.6 H6.4 L6 13 L11 6.4 H7.6 Z（填充）
        Path { p in
            p.move(to: CGPoint(x: 8 * s, y: 1 * s))
            p.addLine(to: CGPoint(x: 3 * s, y: 7.6 * s))
            p.addLine(to: CGPoint(x: 6.4 * s, y: 7.6 * s))
            p.addLine(to: CGPoint(x: 6 * s, y: 13 * s))
            p.addLine(to: CGPoint(x: 11 * s, y: 6.4 * s))
            p.addLine(to: CGPoint(x: 7.6 * s, y: 6.4 * s))
            p.closeSubpath()
        }
        .fill(color)
        .frame(width: size, height: size)
    }
}

@available(iOS 16.1, *)
struct CheckGlyph: View {
    let size: CGFloat
    let color: Color
    var body: some View {
        let s = size / 14.0
        // M2.8 7.4 L5.6 10.2 L11.2 4
        Path { p in
            p.move(to: CGPoint(x: 2.8 * s, y: 7.4 * s))
            p.addLine(to: CGPoint(x: 5.6 * s, y: 10.2 * s))
            p.addLine(to: CGPoint(x: 11.2 * s, y: 4 * s))
        }
        .stroke(color, style: StrokeStyle(lineWidth: max(1.2, 1.6 * s), lineCap: .round, lineJoin: .round))
        .frame(width: size, height: size)
    }
}

@available(iOS 16.1, *)
struct CommandActivityWidget: Widget {
    private static let accent   = Color(red: 0xE2/255.0, green: 0xA2/255.0, blue: 0x8F/255.0)
    private static let cream    = Color(red: 0xED/255.0, green: 0xE6/255.0, blue: 0xD4/255.0)
    private static let creamDim = Color(red: 0xED/255.0, green: 0xE6/255.0, blue: 0xD4/255.0).opacity(0.6)
    private static let t3       = Color(red: 0x7C/255.0, green: 0x71/255.0, blue: 0x63/255.0)
    private static let lockBg   = Color.black.opacity(0.92)

    var body: some WidgetConfiguration {
        ActivityConfiguration(for: CommandActivityAttributes.self) { context in
            lockScreenView(context: context)
                .activityBackgroundTint(Self.lockBg)
                .activitySystemActionForegroundColor(Self.accent)
                .widgetURL(URL(string: "yourapp://command/\(context.attributes.commandId)"))
        } dynamicIsland: { context in
            DynamicIsland {
                DynamicIslandExpandedRegion(.leading) { expandedLeading(context: context) }
                DynamicIslandExpandedRegion(.trailing) { expandedTrailing(context: context) }
                DynamicIslandExpandedRegion(.center) { expandedCenter(context: context) }
                DynamicIslandExpandedRegion(.bottom) { expandedBottom(context: context) }
            } compactLeading: {
                if cmdDone(context) {
                    CheckGlyph(size: 15, color: Self.cream)
                } else {
                    BoltGlyph(size: 15, color: Self.accent)
                }
            } compactTrailing: {
                // running → mmss；over → "+超时多久" count-up；done → "已完成" 短标签
                if cmdDone(context) {
                    Text("已完成")
                        .font(.system(size: 13, weight: .bold))
                        .foregroundColor(Self.cream)
                } else if cmdOver(context) {
                    // 超时：从 endsAt 开始 count-up,告诉用户超了多久(AI 色暗示警示)
                    // ⚠️ 三个计时分支都必须套固定 frame：compact 区的自走计时文本(timer/timerInterval)
                    //    不限宽时,系统按"最宽可能值"把药丸撑成长条 —— 连几十秒的倒计时也填满整条。
                    //    改字号 / padding 都压不住,只有固定 frame 能收住(minimumScaleFactor 防偶发长值截断)。
                    Text(context.state.endsAt, style: .timer)
                        .monospacedDigit()
                        .font(.system(size: 14, weight: .semibold))
                        .foregroundColor(Self.accent)
                        .frame(width: 40, alignment: .trailing)
                        .minimumScaleFactor(0.5)
                } else if context.state.hasCountdown {
                    // .timer 对未来时刻倒数、过了 endsAt 自动转正计时；timerInterval 到点会卡在 0:00
                    //（灵动岛到点不重绘，cmdOver 分支来不及生效，旧写法就是一直 00:00）
                    Text(context.state.endsAt, style: .timer)
                        .monospacedDigit()
                        .font(.system(size: 14, weight: .semibold))
                        .foregroundColor(Self.cream)
                        .frame(width: 40, alignment: .trailing)
                        .minimumScaleFactor(0.5)
                } else {
                    Text(context.state.startedAt, style: .timer)
                        .monospacedDigit()
                        .font(.system(size: 14, weight: .semibold))
                        .foregroundColor(Self.cream)
                        .frame(width: 40, alignment: .trailing)
                        .minimumScaleFactor(0.5)
                }
            } minimal: {
                if cmdDone(context) {
                    CheckGlyph(size: 14, color: Self.cream)
                } else {
                    BoltGlyph(size: 14, color: Self.accent)
                }
            }
            .keylineTint(Self.accent)
            .widgetURL(URL(string: "yourapp://command/\(context.attributes.commandId)"))
        }
    }

    // 完成判定：只看用户**主动**完成(isDone)。不要把"endsAt 到了"当成完成 —— 那是超时态,语义不同。
    private func cmdDone(_ c: ActivityViewContext<CommandActivityAttributes>) -> Bool {
        c.state.isDone
    }
    // 超时:倒计时已过 endsAt 但用户还没主动完成 —— 视觉上保持运行色(AI 橙),但时间显示成"超了多久"
    private func cmdOver(_ c: ActivityViewContext<CommandActivityAttributes>) -> Bool {
        // isStale：staleDate 设在 endsAt，系统到点重绘时据此切超时色
        guard c.state.hasCountdown && !c.state.isDone else { return false }
        if #available(iOS 16.2, *), c.isStale { return true }
        return c.state.endsAt <= Date()
    }

    // 倒计时 / 计时上行的文本（OS 自走）
    @ViewBuilder
    private func countdownText(context: ActivityViewContext<CommandActivityAttributes>, size: CGFloat) -> some View {
        if context.state.hasCountdown {
            Text(context.state.endsAt, style: .timer)
                .monospacedDigit()
                .font(.system(size: size, weight: .semibold))
                .foregroundColor(cmdOver(context) ? Self.accent : Self.cream)
        } else {
            Text(context.state.startedAt, style: .timer)
                .monospacedDigit()
                .font(.system(size: size, weight: .semibold))
                .foregroundColor(Self.cream)
        }
    }

    // ── 锁屏条 ──
    @ViewBuilder
    private func lockScreenView(context: ActivityViewContext<CommandActivityAttributes>) -> some View {
        VStack(spacing: 10) {
            HStack(spacing: 12) {
                ZStack {
                    RoundedRectangle(cornerRadius: 10)
                        .fill(cmdDone(context) ? Color.white.opacity(0.10) : Self.accent.opacity(0.18))
                        .frame(width: 38, height: 38)
                    if cmdDone(context) {
                        CheckGlyph(size: 18, color: Self.cream)
                    } else {
                        BoltGlyph(size: 18, color: Self.accent)
                    }
                }
                VStack(alignment: .leading, spacing: 3) {
                    Text(cmdDone(context) ? "指令完成" : "即时指令进行中")
                        .font(.system(size: 15, weight: .semibold))
                        .foregroundColor(Self.cream)
                    Text("\(context.attributes.issuedBy)：\(context.state.title)")
                        .font(.system(size: 12))
                        .foregroundColor(Self.creamDim)
                        .lineLimit(1)
                }
                Spacer(minLength: 6)
                if cmdDone(context) {
                    CheckGlyph(size: 20, color: Self.cream)
                } else {
                    VStack(alignment: .trailing, spacing: 1) {
                        countdownText(context: context, size: 16)
                        Text(context.state.hasCountdown ? (cmdOver(context) ? "超时" : "剩余") : "已过")
                            .font(.system(size: 10))
                            .foregroundColor(Self.creamDim)
                    }
                }
            }
            if context.state.hasCountdown && !cmdDone(context) {
                ProgressView(timerInterval: context.state.startedAt...context.state.endsAt, countsDown: false)
                    .progressViewStyle(.linear)
                    .tint(Self.accent)
                    .labelsHidden()
                    .frame(height: 3)
            } else {
                Rectangle()
                    .fill(cmdDone(context) ? Self.accent : Self.accent.opacity(0.5))
                    .frame(height: 3)
                    .cornerRadius(2)
            }
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 14)
    }

    // ── expanded 四区 ──
    @ViewBuilder
    private func expandedLeading(context: ActivityViewContext<CommandActivityAttributes>) -> some View {
        ZStack {
            RoundedRectangle(cornerRadius: 10)
                .fill(cmdDone(context) ? Color.white.opacity(0.10) : Self.accent.opacity(0.18))
                .frame(width: 36, height: 36)
            if cmdDone(context) {
                CheckGlyph(size: 17, color: Self.cream)
            } else {
                BoltGlyph(size: 17, color: Self.accent)
            }
        }
        .padding(.leading, 4)
    }

    @ViewBuilder
    private func expandedCenter(context: ActivityViewContext<CommandActivityAttributes>) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            if cmdDone(context) {
                Text("指令完成")
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundColor(Self.cream)
            } else {
                Text("\(context.attributes.issuedBy) 下的指令")
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundColor(Self.cream)
            }
            Text(context.state.title)
                .font(.system(size: 11))
                .foregroundColor(Self.creamDim)
                .lineLimit(1)
        }
    }

    @ViewBuilder
    private func expandedTrailing(context: ActivityViewContext<CommandActivityAttributes>) -> some View {
        if cmdDone(context) {
            CheckGlyph(size: 18, color: Self.cream)
                .padding(.trailing, 4)
        } else {
            VStack(alignment: .trailing, spacing: 1) {
                countdownText(context: context, size: 13)
                Text(context.state.hasCountdown ? (cmdOver(context) ? "超时" : "剩余") : "已过")
                    .font(.system(size: 9))
                    .foregroundColor(Self.creamDim)
            }
            .padding(.trailing, 4)
        }
    }

    @ViewBuilder
    private func expandedBottom(context: ActivityViewContext<CommandActivityAttributes>) -> some View {
        if cmdDone(context) {
            HStack {
                Spacer()
                Text("告诉 \(context.attributes.issuedBy) 你做完了。")
                    .font(.system(size: 11))
                    .foregroundColor(Self.creamDim)
                Spacer()
            }
        } else if context.state.hasCountdown {
            VStack(spacing: 8) {
                Text(context.state.endsAt, style: .timer)
                    .monospacedDigit()
                    .font(.system(size: 30, weight: .semibold, design: .rounded))
                    .foregroundColor(cmdOver(context) ? Self.accent : Self.cream)
                    .frame(maxWidth: .infinity)
                ProgressView(timerInterval: context.state.startedAt...context.state.endsAt, countsDown: false)
                    .progressViewStyle(.linear)
                    .tint(Self.accent)
                    .labelsHidden()
                    .frame(height: 4)
            }
            .padding(.top, 2)
        } else {
            HStack {
                Spacer()
                Text(context.state.startedAt, style: .timer)
                    .monospacedDigit()
                    .font(.system(size: 30, weight: .semibold, design: .rounded))
                    .foregroundColor(Self.cream)
                Spacer()
            }
            .padding(.top, 2)
        }
    }
}
