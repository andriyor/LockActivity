import ActivityKit
import Foundation

struct LockAttributes: ActivityAttributes {
    struct ContentState: Codable, Hashable {
        var message: String
        var startedAt: Date
    }

    var title: String
}
