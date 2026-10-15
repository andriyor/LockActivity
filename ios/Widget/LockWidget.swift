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
      HStack {
        VStack(alignment: .leading, spacing: 4) {
          Text(ctx.state.project ?? ctx.attributes.title).font(.headline)
          Text(ctx.state.message).font(.title3)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        if let startedAt = ctx.state.startedAt {
          // A .timer Text takes all the width it's offered, so give it a fixed one; scales down past 9:59:59
          Text(startedAt, style: .timer)
            .font(.system(size: 40, weight: .semibold).monospacedDigit())
            .lineLimit(1)
            .minimumScaleFactor(0.6)
            .multilineTextAlignment(.trailing)
            .frame(width: 150, alignment: .trailing)
        }
      }
      .foregroundStyle(.white)
      .padding()
      .activityBackgroundTint(.black)  // opaque: a translucent tint shows through in StandBy
      .activitySystemActionForegroundColor(.white)
    } dynamicIsland: { ctx in
      DynamicIsland {
        DynamicIslandExpandedRegion(.center) { Text(ctx.state.message) }
      } compactLeading: {
        TimerIcon(running: ctx.state.startedAt != nil)
      } compactTrailing: {
        if let startedAt = ctx.state.startedAt {
          Text(startedAt, style: .timer).frame(width: 50)
        }
      } minimal: {
        TimerIcon(running: ctx.state.startedAt != nil)
      }
    }
  }
}

// Green play while a timer runs, grey stop when none does.
struct TimerIcon: View {
  let running: Bool
  var body: some View {
    Image(systemName: running ? "play.circle.fill" : "stop.circle")
      .foregroundStyle(running ? .green : .gray)
  }
}
