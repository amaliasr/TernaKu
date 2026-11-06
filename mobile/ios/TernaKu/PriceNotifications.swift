import UIKit
import UserNotifications
import WebKit

final class PriceNotifications: NSObject, WKScriptMessageHandler {
    static let origin = URL(string: "https://ternaku.rstudiohub.com/")!
    private let center = UNUserNotificationCenter.current()
    private let optOutKey = "price.notifications.disabled"
    private let environment = Bundle.main.object(forInfoDictionaryKey: "APNSEnvironment") as? String
    private let installationID = makeInstallationID()
    private var token: String?
    private var waiting = Set<String>()
    private var timer: DispatchWorkItem?
    private var revision = 0
    weak var view: WKWebView?

    // Keep the identifier across launches, but exclude it from device backups and restores.
    private static func makeInstallationID() -> String {
        let id = UUID().uuidString.lowercased()
        do {
            let support = try FileManager.default.url(for: .applicationSupportDirectory, in: .userDomainMask,
                                                       appropriateFor: nil, create: true)
            var directory = support.appendingPathComponent("Notifications", isDirectory: true)
            try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
            var attributes = URLResourceValues()
            attributes.isExcludedFromBackup = true
            try directory.setResourceValues(attributes)
            let file = directory.appendingPathComponent("installation")
            if let saved = try? String(contentsOf: file, encoding: .utf8), UUID(uuidString: saved) != nil {
                return saved
            }
            try id.write(to: file, atomically: true, encoding: .utf8)
        } catch {
            // An inaccessible filesystem still permits a notification in this running session.
        }
        return id
    }

    static func trusted(_ url: URL?) -> Bool {
        guard let url else { return false }
        return url.scheme == "https" && url.host?.lowercased() == origin.host
            && (url.port == nil || url.port == 443) && url.user == nil && url.password == nil
    }

    func userContentController(_ userContentController: WKUserContentController,
                               didReceive message: WKScriptMessage) {
        let sender = message.frameInfo.securityOrigin
        guard message.webView === view, message.frameInfo.isMainFrame,
              sender.protocol == "https", sender.host.lowercased() == Self.origin.host,
              [0, 443].contains(sender.port), Self.trusted(view?.url),
              let body = message.body as? String, body.utf8.count <= 1024,
              let request = try? JSONDecoder().decode(Request.self, from: Data(body.utf8)),
              !request.requestId.isEmpty, request.requestId.count <= 128 else { return }
        switch request.action {
        case "enable":
            UserDefaults.standard.removeObject(forKey: optOutKey)
            let version = revision
            center.requestAuthorization(options: [.alert, .sound]) { [weak self] _, error in
                DispatchQueue.main.async {
                    guard let self, self.revision == version else { return }
                    if error != nil { self.send(request.requestId, "unavailable") }
                    else { self.status(request.requestId) }
                }
            }
        case "disable":
            revision += 1
            UserDefaults.standard.set(true, forKey: optOutKey)
            token = nil
            UIApplication.shared.unregisterForRemoteNotifications()
            center.removeAllDeliveredNotifications()
            finish("default")
            send(request.requestId, "default")
        case "status":
            status(request.requestId)
        case "settings":
            if let url = URL(string: UIApplication.openNotificationSettingsURLString) {
                UIApplication.shared.open(url)
            }
            status(request.requestId)
        default: return
        }
    }

    private struct Request: Decodable {
        let action: String
        let requestId: String
    }

    private func status(_ id: String) {
        let version = revision
        center.getNotificationSettings { [weak self] settings in
            DispatchQueue.main.async {
                guard let self else { return }
                if self.revision != version || UserDefaults.standard.bool(forKey: self.optOutKey) {
                    self.send(id, "default")
                    return
                }
                switch settings.authorizationStatus {
                case .notDetermined: self.send(id, "default")
                case .denied: self.send(id, "denied")
                case .authorized, .provisional, .ephemeral:
                    if self.token != nil { self.send(id, "granted") }
                    else { self.register(id) }
                @unknown default: self.send(id, "unavailable")
                }
            }
        }
    }

    private func register(_ id: String) {
        waiting.insert(id)
        guard timer == nil else { return }
        let timeout = DispatchWorkItem { [weak self] in self?.finish("unavailable") }
        timer = timeout
        DispatchQueue.main.asyncAfter(deadline: .now() + 8, execute: timeout)
        UIApplication.shared.registerForRemoteNotifications()
    }

    func didRegister(_ value: String) {
        guard !UserDefaults.standard.bool(forKey: optOutKey) else { return }
        let changed = token != value
        token = value
        finish("granted")
        if changed {
            evaluate("window.dispatchEvent(new Event('ternaku:native-token-changed'));")
        }
    }

    func didFailRegistration() {
        token = nil
        finish("unavailable")
    }

    private func finish(_ status: String) {
        timer?.cancel()
        timer = nil
        let requests = waiting
        waiting.removeAll()
        for id in requests { send(id, status) }
    }

    private func send(_ id: String, _ status: String) {
        var detail: [String: Any] = [
            "platform": "ios", "requestId": id, "status": status, "installation_id": installationID,
            "optedOut": UserDefaults.standard.bool(forKey: optOutKey)
        ]
        detail["environment"] = environment
        if status == "granted" { detail["token"] = token }
        evaluate("window.dispatchEvent(new CustomEvent('ternaku:native-push', {detail}));",
                 arguments: ["detail": detail])
    }

    private func evaluate(_ script: String, arguments: [String: Any] = [:]) {
        guard let view, Self.trusted(view.url) else { return }
        // Navigation can commit between the native callback and JavaScript execution.
        let guarded = "if (location.origin === 'https://ternaku.rstudiohub.com') { " + script + " }"
        view.callAsyncJavaScript(guarded, arguments: arguments, in: nil, in: .page, completionHandler: nil)
    }
}
