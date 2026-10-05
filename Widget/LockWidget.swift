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
                Text(ctx.attributes.title).font(.headline)
                Text(ctx.state.message).font(.title3)
                Text(ctx.state.startedAt, style: .relative).font(.caption).opacity(0.7)
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
                Text(ctx.state.startedAt, style: .timer).frame(width: 50)
            } minimal: {
                Image(systemName: "lock.fill")
            }
        }
    }
}
