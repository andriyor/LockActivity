#if PUSH
import ActivityKit
import Foundation

/// Reports push tokens to the server so it can start/update/end activities while the app is closed.
enum PushSync {
    static let server = URL(string: Bundle.main.object(forInfoDictionaryKey: "ServerURL") as! String)!

    static func start() {
        Task {
            for await token in Activity<LockAttributes>.pushToStartTokenUpdates {
                await post("push-to-start-token", ["token": token.hex])
            }
        }
        Task {
            // Includes activities the server started via push-to-start.
            for await activity in Activity<LockAttributes>.activityUpdates { track(activity) }
        }
        for activity in Activity<LockAttributes>.activities { track(activity) }
    }

    static func track(_ activity: Activity<LockAttributes>) {
        Task {
            for await token in activity.pushTokenUpdates {
                await post("activity-token", [
                    "id": activity.id,
                    "token": token.hex,
                    "startedAt": activity.content.state.startedAt.timeIntervalSince1970,
                ])
            }
        }
    }

    private static func post(_ path: String, _ body: [String: Any]) async {
        var req = URLRequest(url: server.appending(path: path))
        req.httpMethod = "POST"
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.httpBody = try? JSONSerialization.data(withJSONObject: body)
        do { _ = try await URLSession.shared.data(for: req) } catch { print("PushSync \(path): \(error)") }
    }
}

private extension Data {
    var hex: String { map { String(format: "%02x", $0) }.joined() }
}
#endif
