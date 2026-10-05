import ActivityKit
import SwiftUI

@main
struct LockActivityApp: App {
    #if PUSH
    init() { PushSync.start() }
    #endif

    var body: some Scene {
        WindowGroup { ContentView() }
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
            if p == .active { ensureRunning() }
        }
    }

    // ponytail: only restarts when the app is opened; unattended restarts need server push-to-start
    private func ensureRunning() {
        if let a = current, Date().timeIntervalSince(a.content.state.startedAt) < maxAge { return }
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
                attributes: LockAttributes(title: "Lock Activity"),
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
        let state = LockAttributes.ContentState(message: message, startedAt: a.content.state.startedAt)
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
