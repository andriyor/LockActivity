#if PUSH
  import ActivityKit
  import Foundation

  /// Reports push tokens to the server so it can start/update/end activities while the app is closed.
  enum PushSync {
    static let server = URL(
      string: Bundle.main.object(forInfoDictionaryKey: "ServerURL") as! String)!
    /// Sent as a bearer token; the server checks it when its APP_SECRET is set.
    static let secret = Bundle.main.object(forInfoDictionaryKey: "AppSecret") as? String ?? ""

    static func start() {
      Task {
        for await token in Activity<LockAttributes>.pushToStartTokenUpdates {
          await post("push-to-start-token", ["token": token.hex])
        }
      }
      Task {
        // Includes activities the server started via push-to-start.
        for await activity in Activity<LockAttributes>.activityUpdates {
          // The server tracks one activity; end leftovers so its end push clears the Lock Screen.
          for old in Activity<LockAttributes>.activities where old.id != activity.id {
            await old.end(nil, dismissalPolicy: .immediate)
          }
          track(activity)
        }
      }
      for activity in Activity<LockAttributes>.activities { track(activity) }
      // Lets the server replace its activity if it's gone (dismissed, ended by iOS, reinstall).
      let alive = Activity<LockAttributes>.activities
        .filter { $0.activityState == .active || $0.activityState == .stale }
        .map(\.id)
      Task { await post("activities", ["ids": alive]) }
    }

    static func track(_ activity: Activity<LockAttributes>) {
      Task {
        for await token in activity.pushTokenUpdates {
          await post(
            "activity-token",
            [
              "id": activity.id,
              "token": token.hex,
              "startedAt": activity.content.state.startedAt?.timeIntervalSince1970 ?? NSNull(),
            ])
        }
      }
    }

    private static func post(_ path: String, _ body: [String: Any]) async {
      var req = URLRequest(url: server.appending(path: path))
      req.httpMethod = "POST"
      req.setValue("application/json", forHTTPHeaderField: "Content-Type")
      if !secret.isEmpty { req.setValue("Bearer \(secret)", forHTTPHeaderField: "Authorization") }
      req.httpBody = try? JSONSerialization.data(withJSONObject: body)
      do { _ = try await URLSession.shared.data(for: req) } catch {
        print("PushSync \(path): \(error)")
      }
    }
  }

  extension Data {
    fileprivate var hex: String { map { String(format: "%02x", $0) }.joined() }
  }
#endif
