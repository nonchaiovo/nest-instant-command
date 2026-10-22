//
//  CommandActivityAttributes.swift
//  即时指令进行中 · Live Activity 数据契约
//
//  Target Membership: 主 App + Widget Extension（两个都勾）
//
//  场景：AI 下了一条即时指令（如"安静读 25 分钟"）。app 切后台 / 锁屏时，
//  灵动岛盯着它在跑——指令内容、剩余时间 / 已过时间、进度、完成态。
//  指令只有 AI 能下，所以没有"你下的"那一版。
//

import Foundation
import ActivityKit

@available(iOS 16.1, *)
struct CommandActivityAttributes: ActivityAttributes {
    public struct ContentState: Codable, Hashable {
        /// 指令开始时刻 —— Widget 用 Text(timerInterval:) 自动每秒走
        var startedAt: Date
        /// 倒计时终点（hasCountdown=true 时有效）；计时上行时 == startedAt
        var endsAt: Date
        /// true = 倒计时（剩余）；false = 计时上行（已过）
        var hasCountdown: Bool
        /// 指令内容 "安静读 25 分钟"
        var title: String
        /// 完成态 → 勾 + "指令完成"
        var isDone: Bool
    }
    /// 指令 id（deeplink / 索引）
    var commandId: Int
    /// 谁下的 —— "AI"
    var issuedBy: String
}
