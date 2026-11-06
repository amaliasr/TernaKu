import UIKit
import UserNotifications

@main
final class AppDelegate: UIResponder, UIApplicationDelegate, UNUserNotificationCenterDelegate {
    let push = PriceNotifications()

    func application(_ application: UIApplication,
                     didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?) -> Bool {
        UNUserNotificationCenter.current().delegate = self
        return true
    }

    func application(_ application: UIApplication, didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data) {
        push.didRegister(deviceToken.map { String(format: "%02x", $0) }.joined())
    }

    func application(_ application: UIApplication, didFailToRegisterForRemoteNotificationsWithError error: Error) {
        push.didFailRegistration()
    }

    func userNotificationCenter(_ center: UNUserNotificationCenter, willPresent notification: UNNotification,
                                withCompletionHandler completionHandler: @escaping (UNNotificationPresentationOptions) -> Void) {
        completionHandler([.banner, .list, .sound])
    }
}

final class SceneDelegate: UIResponder, UIWindowSceneDelegate {
    var window: UIWindow?

    func scene(_ scene: UIScene, willConnectTo session: UISceneSession, options connectionOptions: UIScene.ConnectionOptions) {
        guard let scene = scene as? UIWindowScene, let app = UIApplication.shared.delegate as? AppDelegate else { return }
        let window = UIWindow(windowScene: scene)
        window.rootViewController = FarmViewController(push: app.push)
#if TERNAKU_UI_SMOKE && targetEnvironment(simulator)
        if let mode = ProcessInfo.processInfo.environment["TERNAKU_SIMULATOR_NOTIFICATIONS"] {
            window.rootViewController = SimulatorNotificationProbe(mode: mode)
        }
#endif
        self.window = window
        window.makeKeyAndVisible()
    }
}

#if TERNAKU_UI_SMOKE && targetEnvironment(simulator)
// Compiled only by the simulator smoke test, never in an archive or ordinary app build.
private final class SimulatorNotificationProbe: UIViewController {
    private let mode: String
    private let label = UILabel()
    init(mode: String) {
        self.mode = mode
        super.init(nibName: nil, bundle: nil)
    }
    required init?(coder: NSCoder) { nil }
    override func viewDidLoad() {
        super.viewDidLoad()
        label.frame = view.bounds
        label.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        label.textAlignment = .center
        label.adjustsFontSizeToFitWidth = true
        view.addSubview(label)
        let center = UNUserNotificationCenter.current()
        if mode == "permission" {
            center.removeAllDeliveredNotifications()
            center.requestAuthorization(options: [.alert, .sound]) { allowed, _ in
                DispatchQueue.main.async { self.label.text = allowed ? "Notification permission granted" : "Permission denied" }
            }
        } else {
            center.getDeliveredNotifications { delivered in
                let prices = delivered.map { $0.request.content }.filter { $0.body == "Bagus Rp28.000/kg, bentes Rp18.000/kg." }
                let ids = Set(prices.compactMap { $0.userInfo["tag"] as? String })
                DispatchQueue.main.async {
                    self.label.text = ids == ["price-smoke-a", "price-smoke-b"]
                        ? "Both equal-price notifications delivered" : "Missing price notification"
                }
            }
        }
    }
}
#endif
