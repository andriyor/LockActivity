import ActivityKit
import SwiftUI

@main
struct LockActivityApp: App {
  #if PUSH
    init() { PushSync.start() }
  #endif

  var body: some Scene {
    #if PUSH  // the server owns the activity (it mirrors Toggl); just show it
      WindowGroup { RunningTimerView() }
    #else
      WindowGroup { ContentView() }
    #endif
  }
}

/// What the Live Activity currently shows, kept live as server pushes arrive.
struct RunningTimerView: View {
  @State private var activity = Activity<LockAttributes>.activities.first {
    $0.activityState == .active
  }
  @State private var state: LockAttributes.ContentState?

  var body: some View {
    VStack(spacing: 8) {
      if let state {
        if let project = state.project { Text(project).font(.headline) }
        Text(state.message).font(.title2)
        if let startedAt = state.startedAt {
          Text(startedAt, style: .timer).font(.largeTitle.monospacedDigit())
        }
      } else {
        Text("No Live Activity yet").foregroundStyle(.secondary)
      }
    }
    .multilineTextAlignment(.center)
    .padding()
    .task {
      for await a in Activity<LockAttributes>.activityUpdates { activity = a }
    }
    .task(id: activity?.id) {
      guard let activity else { return }
      state = activity.content.state
      for await content in activity.contentUpdates { state = content.state }
    }
  }
}

struct ContentView: View {
  @Environment(\.scenePhase) private var phase
  @State private var message = "Hello from the Lock Screen"
  @State private var status = ""

  // iOS kills an activity after 8h; restart a bit earlier.
  private let maxAge: TimeInterval = 7 * 3600

  #if PUSH
    private let pushType: PushType? = .token
  #else
    private let pushType: PushType? = nil
  #endif

  private var current: Activity<LockAttributes>? {
    Activity<LockAttributes>.activities.first { $0.activityState == .active }
  }

  var body: some View {
    Form {
      TextField("Message", text: $message)
      Button("Start / Restart") { start() }
      Button("Update") { update() }
      Button("End", role: .destructive) { end(except: nil) }
      if !status.isEmpty { Text(status).foregroundStyle(.secondary) }
    }
    .onChange(of: phase, initial: true) { _, p in
      #if !PUSH  // with push the server owns the activity (it mirrors Toggl)
        if p == .active { ensureRunning() }
      #endif
    }
  }

  // ponytail: only restarts when the app is opened; unattended restarts need server push-to-start
  private func ensureRunning() {
    if let a = current, let startedAt = a.content.state.startedAt,
      Date().timeIntervalSince(startedAt) < maxAge
    {
      return
    }
    start()
  }

  private func start() {
    guard ActivityAuthorizationInfo().areActivitiesEnabled else {
      status = "Live Activities are disabled in Settings"
      return
    }
    let state = LockAttributes.ContentState(message: message, startedAt: .now)
    do {
      let new = try Activity.request(
        attributes: LockAttributes(title: "Toggl Lock"),
        content: .init(state: state, staleDate: .now.addingTimeInterval(8 * 3600)),
        pushType: pushType
      )
      #if PUSH
        PushSync.track(new)
      #endif
      end(except: new.id)
      status = "Started"
    } catch {
      status = "Error: \(error.localizedDescription)"
    }
  }

  private func update() {
    guard let a = current else { return start() }
    let state = LockAttributes.ContentState(
      message: message, project: a.content.state.project, startedAt: a.content.state.startedAt)
    Task { await a.update(.init(state: state, staleDate: a.content.staleDate)) }
    status = "Updated"
  }

  private func end(except id: String?) {
    for a in Activity<LockAttributes>.activities where a.id != id {
      Task { await a.end(nil, dismissalPolicy: .immediate) }
    }
    if id == nil { status = "Ended" }
  }
}
