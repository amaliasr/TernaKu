import UIKit
import WebKit

final class FarmViewController: UIViewController, WKNavigationDelegate, WKUIDelegate, WKDownloadDelegate {
    private let push: PriceNotifications
    private var web: WKWebView!
    private var downloads: [ObjectIdentifier: URL] = [:]
    private let retry = UIButton(type: .system)

    init(push: PriceNotifications) {
        self.push = push
        super.init(nibName: nil, bundle: nil)
    }

    required init?(coder: NSCoder) { nil }

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = .systemBackground
        let configuration = WKWebViewConfiguration()
        configuration.websiteDataStore = .default()
        configuration.userContentController.add(push, name: "TernaKuIOS")
        web = WKWebView(frame: .zero, configuration: configuration)
        push.view = web
        web.navigationDelegate = self
        web.uiDelegate = self
        web.allowsBackForwardNavigationGestures = true
        web.scrollView.contentInsetAdjustmentBehavior = .never
        let safe = view.safeAreaLayoutGuide
        web.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(web)
        retry.setTitle("TernaKu belum tersambung. Coba lagi", for: .normal)
        retry.addTarget(self, action: #selector(loadFarm), for: .touchUpInside)
        retry.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(retry)
        NSLayoutConstraint.activate([
            web.topAnchor.constraint(equalTo: safe.topAnchor), web.bottomAnchor.constraint(equalTo: safe.bottomAnchor),
            web.leadingAnchor.constraint(equalTo: safe.leadingAnchor), web.trailingAnchor.constraint(equalTo: safe.trailingAnchor),
            retry.centerXAnchor.constraint(equalTo: safe.centerXAnchor), retry.centerYAnchor.constraint(equalTo: safe.centerYAnchor)
        ])
        loadFarm()
    }

    @objc private func loadFarm() {
        retry.isHidden = true
        web.isHidden = false
        web.load(URLRequest(url: PriceNotifications.origin, cachePolicy: .reloadRevalidatingCacheData))
    }

    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
        guard (error as NSError).code != NSURLErrorCancelled, webView.url == nil else { return }
        retry.isHidden = false
        web.isHidden = true
    }

    func webViewWebContentProcessDidTerminate(_ webView: WKWebView) { loadFarm() }

    func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction,
                 decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        guard let url = action.request.url else { decisionHandler(.cancel); return }
        let trusted = PriceNotifications.trusted(url)
        let localExport = url.scheme == "blob"
            && url.absoluteString.hasPrefix("blob:https://ternaku.rstudiohub.com/")
        if action.shouldPerformDownload, action.sourceFrame.isMainFrame, PriceNotifications.trusted(web.url),
           trusted || localExport {
            decisionHandler(.download)
            return
        }
        if trusted {
            if action.targetFrame == nil {
                webView.load(action.request)
                decisionHandler(.cancel)
            } else {
                decisionHandler(.allow)
            }
            return
        }
        if action.navigationType == .linkActivated, action.sourceFrame.isMainFrame,
           ["https", "mailto", "tel"].contains(url.scheme ?? "") {
            UIApplication.shared.open(url)
        }
        decisionHandler(.cancel)
    }

    func webView(_ webView: WKWebView, runJavaScriptConfirmPanelWithMessage message: String,
                 initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping (Bool) -> Void) {
        guard frame.isMainFrame, PriceNotifications.trusted(web.url), presentedViewController == nil else {
            completionHandler(false)
            return
        }
        let alert = UIAlertController(title: "TernaKu", message: message, preferredStyle: .alert)
        alert.addAction(UIAlertAction(title: "Batal", style: .cancel) { _ in completionHandler(false) })
        alert.addAction(UIAlertAction(title: "Lanjutkan", style: .default) { _ in completionHandler(true) })
        present(alert, animated: true)
    }

    func webView(_ webView: WKWebView, navigationAction: WKNavigationAction, didBecome download: WKDownload) {
        download.delegate = self
    }

    func download(_ download: WKDownload, decideDestinationUsing response: URLResponse,
                  suggestedFilename: String, completionHandler: @escaping (URL?) -> Void) {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString, isDirectory: true)
        let filename = (suggestedFilename as NSString).lastPathComponent
        guard !["", "/", ".", ".."].contains(filename) else { completionHandler(nil); return }
        do {
            try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: false)
            let url = directory.appendingPathComponent(filename)
            downloads[ObjectIdentifier(download)] = url
            completionHandler(url)
        } catch { completionHandler(nil) }
    }

    func downloadDidFinish(_ download: WKDownload) {
        guard let file = downloads.removeValue(forKey: ObjectIdentifier(download)) else { return }
        let sheet = UIActivityViewController(activityItems: [file], applicationActivities: nil)
        sheet.popoverPresentationController?.sourceView = view
        sheet.popoverPresentationController?.sourceRect = CGRect(x: view.bounds.midX, y: view.bounds.midY, width: 1, height: 1)
        sheet.completionWithItemsHandler = { _, _, _, _ in
            try? FileManager.default.removeItem(at: file.deletingLastPathComponent())
        }
        present(sheet, animated: true)
    }

    func download(_ download: WKDownload, didFailWithError error: Error, resumeData: Data?) {
        if let file = downloads.removeValue(forKey: ObjectIdentifier(download)) {
            try? FileManager.default.removeItem(at: file.deletingLastPathComponent())
        }
    }
}
