import XCTest

final class PriceAlertsUITests: XCTestCase {
    func testTwoEqualPricesArriveWhileTerminated() throws {
        let app = XCUIApplication()
        app.launchEnvironment["TERNAKU_SIMULATOR_NOTIFICATIONS"] = "permission"
        app.launch()
        let springboard = XCUIApplication(bundleIdentifier: "com.apple.springboard")
        if springboard.alerts.firstMatch.waitForExistence(timeout: 6) {
            springboard.alerts.buttons["Allow"].tap()
        }
        XCTAssertTrue(app.staticTexts["Notification permission granted"].waitForExistence(timeout: 10))
        app.terminate()
        XCTAssertEqual(app.state, .notRunning)

        // The macOS driver injects both alerts with simctl while this app is terminated.
        let runID = UUID().uuidString
        let directory = FileManager.default.temporaryDirectory
        let ready = directory.appendingPathComponent("ternaku-price-ready")
        let done = directory.appendingPathComponent("ternaku-price-delivered")
        try runID.write(to: ready, atomically: true, encoding: .utf8)
        defer { try? FileManager.default.removeItem(at: ready) }
        let injected = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in
            (try? String(contentsOf: done, encoding: .utf8)) == runID
        }, object: nil)
        XCTAssertEqual(XCTWaiter.wait(for: [injected], timeout: 70), .completed)
        XCTAssertEqual(app.state, .notRunning)

        app.launchEnvironment["TERNAKU_SIMULATOR_NOTIFICATIONS"] = "inspect"
        app.launch()
        XCTAssertTrue(app.staticTexts["Both equal-price notifications delivered"].waitForExistence(timeout: 15))
    }
}
