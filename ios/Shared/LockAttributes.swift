import ActivityKit
import Foundation

struct LockAttributes: ActivityAttributes {
  struct ContentState: Codable, Hashable {
    var message: String
    var project: String?
    var startedAt: Date?  // nil: nothing running, no timer shown
  }

  var title: String
}
