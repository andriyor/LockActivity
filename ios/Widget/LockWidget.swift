import ActivityKit
import SwiftUI
import WidgetKit

@main
struct LockWidgetBundle: WidgetBundle {
    var body: some Widget { LockLiveActivity() }
}

struct LockLiveActivity: Widget {
    var body: some WidgetConfiguration {
        ActivityConfiguration(for: LockAttributes.self) { ctx in
            VStack(alignment: .leading, spacing: 4) {
                Text(ctx.state.project ?? ctx.attributes.title).font(.headline)
                Text(ctx.state.message).font(.title3)
                if let startedAt = ctx.state.startedAt {
                    Text(startedAt, style: .timer).font(.title2.monospacedDigit())
                }
            }
            .foregroundStyle(.white)
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding()
            .activityBackgroundTint(.black.opacity(0.6))
            .activitySystemActionForegroundColor(.white)
        } dynamicIsland: { ctx in
            DynamicIsland {
                DynamicIslandExpandedRegion(.center) { Text(ctx.state.message) }
            } compactLeading: {
                Image(systemName: "lock.fill")
            } compactTrailing: {
                if let startedAt = ctx.state.startedAt {
                    Text(startedAt, style: .timer).frame(width: 50)
                }
            } minimal: {
                Image(systemName: "lock.fill")
            }
        }
    }
}
