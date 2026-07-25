import AtriumCaptureContracts
import AtriumCaptureCore
import AtriumCaptureMacPlatform
import Foundation

#if os(macOS)
import AppKit
import CoreGraphics
import ServiceManagement
import SwiftUI

@MainActor
final class CaptureAppModel: ObservableObject {
    enum LaunchAtLoginState: Equatable {
        case disabled
        case enabled
        case requiresApproval
        case unavailable
    }

    private struct ScreenshotPreviewCacheEntry {
        let assetID: String
        let revision: Int
        let image: NSImage
    }

    @Published private(set) var session: AtriumCaptureSession?
    @Published private(set) var permissions = MacPermissionCenter.snapshot()
    @Published private(set) var statusCode = "READY"
    @Published private(set) var publishJob: AtriumCapturePublishJob?
    @Published private(set) var guides: [AtriumCaptureSession] = []
    @Published private(set) var publicationStarting = false
    @Published private(set) var pins: [PinnedCapture] = []
    @Published private(set) var atriumAuthentication: NativeAuthenticationStatus = .unconfigured
    @Published private(set) var launchAtLoginState: LaunchAtLoginState = .disabled
    @Published var manualInstruction = ""

    private let recorder: NativeRecorder
    private let repository: FileNativePublishRepository
    private let vault: NativeAssetVault
    private let monitor: MacEventMonitor
    private let publisher: DurableNativePublisher
    private let oauthCoordinator: NativeOAuthCoordinator
    private let productionSettings: NativeAtriumProductionSettings?
    private let defaultCollectionID: String?
    private let localMockEnabled: Bool
    private let capture: SerializedNativeCapture
    private let reader: AccessibilitySemanticReader
    private let regionSelector: RegionSelectionController
    private let pinBoard: PinBoard
    private let pinWindows = PinnedImageWindowManager()
    private let clipboard = MacClipboardController()
    private let shortcuts = GlobalCaptureShortcuts()
    private var permissionTimer: Timer?
    private var screenshotImageCache: [String: ScreenshotPreviewCacheEntry] = [:]

    var currentSessionHasPublishJob: Bool {
        guard let session else { return false }
        return publishJob?.sessionID == session.sessionID
    }

    var currentGuideContentFrozen: Bool {
        publicationStarting || currentSessionHasPublishJob
    }

    var hasUnfinishedPublishJob: Bool {
        if publicationStarting { return true }
        guard currentSessionHasPublishJob, let phase = publishJob?.phase else { return false }
        return phase != .readyAsDraft && phase != .complete
    }

    var canRetryPublish: Bool {
        currentSessionHasPublishJob
            && publishJob?.lastError != nil
    }

    var canOpenAtriumDraft: Bool {
        publishJob?.readerURL != nil
    }

    var canEditGuideContent: Bool {
        guard !currentGuideContentFrozen, let state = session?.state else { return false }
        return state == .review || state == .publishable
    }

    var canEditGuideTitle: Bool {
        session != nil
    }

    var canStartRecording: Bool {
        session?.state != .recording && session?.state != .paused
    }

    var canQuickCapture: Bool {
        guard let session else { return true }
        return session.state != .recording && session.state != .paused
    }

    var canPinReviewedImage: Bool {
        session?.assets.contains(where: { $0.state == .publishableLocal }) == true
    }

    var launchAtLoginEnabled: Bool {
        launchAtLoginState == .enabled
    }

    var launchAtLoginAvailable: Bool {
        launchAtLoginState != .unavailable
    }

    var publishFailureGuidance: String? {
        guard let job = publishJob, let failure = job.lastError else { return nil }
        if failure.code == "TITLE_UPDATE_FAILED" {
            return failure.retryable
                ? "The new title is saved locally. Retry to update the Atrium title."
                : "The new title is saved locally, but Atrium rejected the title update. Sign in again or contact district support."
        }
        guard job.phase != .readyAsDraft, job.phase != .complete else { return nil }
        let action = switch job.phase {
        case .queued, .creatingObject:
            "Atrium did not confirm the private-draft create request. The title may already exist, but no image was uploaded."
        case .uploadingAssets:
            "Atrium created the private draft, but did not confirm the reviewed image upload."
        case .creatingVersion:
            "Atrium received the reviewed image, but did not confirm the document body."
        case .publishingInternal:
            "The private draft is safe, but Atrium did not confirm internal publication."
        case .needsAttention:
            "Atrium rejected this publish request. The reviewed local image remains protected."
        case .readyAsDraft, .complete:
            ""
        }
        let next = failure.retryable
            ? "Retry reuses the same durable request; do not start the capture over."
            : "Try again after confirming sign-in. If the same code repeats, contact district support."
        return "\(action) \(next)"
    }

    init() {
        do {
            let environment = ProcessInfo.processInfo.environment
            let root = try MacApplicationSupport.rootURL(environment: environment)
            let productionAcceptanceResultURL =
                try Self.productionAcceptanceResultURL(environment: environment, root: root)
            let recorder = try NativeRecorder(
                persistence: FileNativeRecorderPersistence(url: root.appendingPathComponent("recorder-state.json"))
            )
            let vault = NativeAssetVault(rootURL: root)
            let capture = SerializedNativeCapture(source: ScreenCaptureKitFrameSource())
            let reader = AccessibilitySemanticReader()
            let pipeline = MacCapturePipeline(
                recorder: recorder,
                reader: reader,
                capture: capture,
                vault: vault
            )
            let oauthCoordinator = NativeOAuthCoordinator()
            let productionSettings = NativeAtriumProductionSettings.load()
            let localMockEnabled = environment["ATRIUM_CAPTURE_LOCAL_MOCK"] == "1"
            let gateway: any NativeAtriumGateway
            if localMockEnabled {
                gateway = MockNativeAtriumGateway()
            } else if let productionSettings {
                gateway = try ProductionNativeAtriumGateway {
                    try await oauthCoordinator.accessToken(configuration: productionSettings.oauth)
                }
            } else {
                gateway = UnavailableNativeAtriumGateway()
            }
            self.recorder = recorder
            repository = FileNativePublishRepository(rootURL: root)
            self.vault = vault
            monitor = MacEventMonitor(pipeline: pipeline)
            publisher = DurableNativePublisher(repository: repository, gateway: gateway)
            self.oauthCoordinator = oauthCoordinator
            self.productionSettings = productionSettings
            defaultCollectionID = productionSettings?.defaultCollectionID
            self.localMockEnabled = localMockEnabled
            self.capture = capture
            self.reader = reader
            regionSelector = RegionSelectionController(capture: capture)
            pinBoard = try PinBoard(
                persistence: FilePinBoardPersistence(url: root.appendingPathComponent("pin-history.json"))
            )
            try Self.seedSyntheticReviewIfRequested(
                environment: environment,
                recorder: recorder,
                repository: repository,
                vault: vault
            )
            let recorderSession = recorder.snapshot()
            if let recorderSession {
                let canonical = try repository.reconcileSession(recorderSession)
                try recorder.replaceReviewedSession(canonical)
                session = canonical
            } else if let saved = try repository.listSessions().first {
                try recorder.activateStoredSession(saved)
                session = saved
            }
            guides = try repository.listSessions()
            publishJob = try repository.listJobs().last(where: {
                $0.sessionID == session?.sessionID
            })
            if let publishJob {
                switch publishJob.phase {
                case .readyAsDraft:
                    statusCode = "PRIVATE_DRAFT_READY"
                case .complete:
                    statusCode = "INTERNAL_PUBLICATION_COMPLETE"
                case .needsAttention:
                    statusCode = "PUBLISH_NEEDS_ATTENTION"
                default:
                    statusCode = publishJob.lastError.map {
                        "PUBLISH_FAILED_\($0.code)"
                    } ?? "PUBLISH_PENDING"
                }
            }
            refreshLaunchAtLoginState()
            pins = pinBoard.snapshot().pins
            for pin in pins {
                if let data = try? vault.read(localKey: pin.localKey) {
                    pinWindows.show(pin: pin, pngData: data)
                }
            }
            pinWindows.onFrameChange = { [weak self] pinID, frame, displayID in
                self?.persistPinFrame(pinID: pinID, frame: frame, displayID: displayID)
            }
            shortcuts.captureRegion = { [weak self] in self?.captureRegion() }
            shortcuts.captureElement = { [weak self] in self?.captureElement() }
            shortcuts.togglePins = { [weak self] in self?.pinWindows.toggleVisibility() }
            shortcuts.start()
            permissionTimer = Timer.scheduledTimer(withTimeInterval: 2, repeats: true) { [weak self] _ in
                Task { @MainActor in self?.handlePermissionChange() }
            }
            if localMockEnabled {
                atriumAuthentication = .signedIn
                Task { @MainActor [weak self] in
                    await self?.resumePendingPublications()
                }
            } else if let productionSettings {
                atriumAuthentication = .signedOut
                Task { @MainActor [weak self] in
                    guard let self else { return }
                    atriumAuthentication = await oauthCoordinator.status(
                        configuration: productionSettings.oauth
                    )
                    if let productionAcceptanceResultURL {
                        do {
                            if atriumAuthentication != .signedIn {
                                _ = try await oauthCoordinator.signIn(
                                    configuration: productionSettings.oauth
                                )
                                atriumAuthentication = .signedIn
                            }
                            await runProductionAcceptance(
                                resultURL: productionAcceptanceResultURL
                            )
                        } catch {
                            writeProductionAcceptanceResult(
                                [
                                    "status": "fail",
                                    "stage": "authentication",
                                ],
                                to: productionAcceptanceResultURL
                            )
                            NSApplication.shared.terminate(nil)
                        }
                    } else if atriumAuthentication == .signedIn {
                        await resumePendingPublications()
                    }
                }
            }
        } catch {
            let failure = error as NSError
            fatalError(
                "Atrium Capture could not initialize local storage "
                    + "(\(failure.domain):\(failure.code))."
            )
        }
    }

    private static func seedSyntheticReviewIfRequested(
        environment: [String: String],
        recorder: NativeRecorder,
        repository: FileNativePublishRepository,
        vault: NativeAssetVault
    ) throws {
        guard
            environment["ATRIUM_CAPTURE_LOCAL_MOCK"] == "1"
                || environment["ATRIUM_CAPTURE_PRODUCTION_ACCEPTANCE"] == "1",
            environment["ATRIUM_CAPTURE_UI_FIXTURE"] == "review",
            recorder.snapshot() == nil
        else {
            return
        }

        let productionAcceptance =
            environment["ATRIUM_CAPTURE_PRODUCTION_ACCEPTANCE"] == "1"
        let identifier: (String) -> String = { deterministicValue in
            productionAcceptance ? UUID().uuidString.lowercased() : deterministicValue
        }
        let sessionID = identifier("71000000-0000-4000-8000-000000000001")
        let baseDate = Date(timeIntervalSince1970: 1_768_473_600)
        _ = try recorder.start(
            sessionID: sessionID,
            title: "Synthetic native review guide",
            appVersion: "1.0.0-ui-test",
            osVersion: "synthetic",
            now: baseDate
        )
        let frame = NativeCapturedFrame(
            pngData: try syntheticReviewPNG(),
            pixelWidth: 900,
            pixelHeight: 520,
            backingScaleFactor: 2
        )
        let firstAsset = try vault.writeRaw(
            frame: frame,
            sessionID: sessionID,
            assetID: identifier("72000000-0000-4000-8000-000000000001")
        )
        let secondAsset = try vault.writeRaw(
            frame: frame,
            sessionID: sessionID,
            assetID: identifier("72000000-0000-4000-8000-000000000002")
        )
        _ = try recorder.record(
            NativeSemanticEvent(
                eventID: identifier("73000000-0000-4000-8000-000000000001"),
                occurredAt: baseDate.addingTimeInterval(1),
                action: .click,
                accessibilityRole: "AXButton",
                accessibleName: "Synthetic continue button",
                bounds: NativeRect(x: 70, y: 90, width: 220, height: 48),
                appName: "Synthetic Fixture",
                bundleID: "org.example.synthetic-fixture",
                windowTitle: "Synthetic workflow",
                backingScaleFactor: 2
            ),
            screenshot: firstAsset
        )
        _ = try recorder.record(
            NativeSemanticEvent(
                eventID: identifier("73000000-0000-4000-8000-000000000002"),
                occurredAt: baseDate.addingTimeInterval(2),
                action: .input,
                accessibilityRole: "AXTextField",
                accessibleName: "Synthetic account field",
                bounds: NativeRect(x: 70, y: 170, width: 420, height: 48),
                appName: "Synthetic Fixture",
                bundleID: "org.example.synthetic-fixture",
                windowTitle: "Synthetic workflow",
                backingScaleFactor: 2
            ),
            screenshot: secondAsset
        )
        let stopped = try recorder.stop(now: baseDate.addingTimeInterval(3))
        let canonical = try repository.reconcileSession(stopped)
        try recorder.replaceReviewedSession(canonical)
    }

    private static func syntheticReviewPNG() throws -> Data {
        guard
            let bitmap = NSBitmapImageRep(
                bitmapDataPlanes: nil,
                pixelsWide: 900,
                pixelsHigh: 520,
                bitsPerSample: 8,
                samplesPerPixel: 4,
                hasAlpha: true,
                isPlanar: false,
                colorSpaceName: .deviceRGB,
                bytesPerRow: 0,
                bitsPerPixel: 0
            ),
            let context = NSGraphicsContext(bitmapImageRep: bitmap)
        else {
            throw CocoaError(.fileWriteUnknown)
        }

        NSGraphicsContext.saveGraphicsState()
        NSGraphicsContext.current = context
        NSColor(calibratedRed: 0.96, green: 0.97, blue: 0.96, alpha: 1).setFill()
        NSRect(x: 0, y: 0, width: 900, height: 520).fill()
        NSColor(calibratedRed: 0.05, green: 0.23, blue: 0.21, alpha: 1).setFill()
        NSBezierPath(roundedRect: NSRect(x: 55, y: 380, width: 790, height: 78), xRadius: 16, yRadius: 16)
            .fill()
        NSString(string: "Synthetic workflow preview").draw(
            at: NSPoint(x: 82, y: 402),
            withAttributes: [
                .font: NSFont.systemFont(ofSize: 24, weight: .bold),
                .foregroundColor: NSColor.white,
            ]
        )
        NSColor.white.setFill()
        NSBezierPath(roundedRect: NSRect(x: 55, y: 74, width: 790, height: 270), xRadius: 16, yRadius: 16)
            .fill()
        NSString(string: "Synthetic account field").draw(
            at: NSPoint(x: 82, y: 262),
            withAttributes: [
                .font: NSFont.systemFont(ofSize: 17, weight: .semibold),
                .foregroundColor: NSColor.darkGray,
            ]
        )
        NSColor(calibratedWhite: 0.91, alpha: 1).setFill()
        NSBezierPath(roundedRect: NSRect(x: 82, y: 194, width: 560, height: 48), xRadius: 8, yRadius: 8)
            .fill()
        NSColor(calibratedRed: 0.05, green: 0.23, blue: 0.21, alpha: 1).setFill()
        NSBezierPath(roundedRect: NSRect(x: 82, y: 112, width: 245, height: 52), xRadius: 10, yRadius: 10)
            .fill()
        NSString(string: "Continue").draw(
            at: NSPoint(x: 158, y: 126),
            withAttributes: [
                .font: NSFont.systemFont(ofSize: 18, weight: .semibold),
                .foregroundColor: NSColor.white,
            ]
        )
        context.flushGraphics()
        NSGraphicsContext.restoreGraphicsState()
        guard let data = bitmap.representation(using: .png, properties: [:]) else {
            throw CocoaError(.fileWriteUnknown)
        }
        return data
    }

    private static func productionAcceptanceResultURL(
        environment: [String: String],
        root: URL
    ) throws -> URL? {
        guard environment["ATRIUM_CAPTURE_PRODUCTION_ACCEPTANCE"] == "1" else {
            return nil
        }
        guard
            environment["ATRIUM_CAPTURE_LOCAL_MOCK"] != "1",
            environment["ATRIUM_CAPTURE_UI_FIXTURE"] == "review"
        else {
            throw CocoaError(.fileReadNoPermission)
        }
        // MacApplicationSupport.rootURL has already required and bounded this
        // exact production-acceptance root. Do not re-normalize it here: directory
        // URLs may have an empty lastPathComponent when they retain a trailing
        // slash, causing a valid isolated root to fail initialization.
        return root.appendingPathComponent("acceptance-result.json")
    }

    private func runProductionAcceptance(resultURL: URL) async {
        do {
            guard let sensitiveStep = session?.steps.first(where: { $0.action == .input }) else {
                throw NativeReviewError.stepNotFound
            }
            addAnnotation(
                stepID: sensitiveStep.stepID,
                kind: .redaction,
                geometry: Geometry(height: 70, width: 480, x: 90, y: 150)
            )
            flattenAndApprove()
            guard let reviewed = session,
                  reviewed.state == .publishable,
                  reviewed.policy.reviewStatus == .approved
            else {
                throw NativeReviewError.incompletePrivacyReview
            }
            let existingJob = try repository.listJobs().last(where: {
                $0.sessionID == reviewed.sessionID
            })
            var job: AtriumCapturePublishJob
            if let existingJob {
                job = existingJob.phase == .needsAttention
                    ? try await publisher.retry(jobID: existingJob.jobID)
                    : try await publisher.resume(jobID: existingJob.jobID)
            } else {
                job = try await publisher.enqueue(
                    session: reviewed,
                    collectionID: defaultCollectionID
                )
                job = try await publisher.resume(jobID: job.jobID)
            }
            publishJob = job
            guard
                job.phase == .readyAsDraft,
                job.contentObjectID != nil,
                job.currentVersionID != nil,
                job.readerURL != nil,
                job.assetUploads?.allSatisfy({
                    $0.state == .ready && $0.remoteAssetID != nil
                }) == true
            else {
                throw NativePublishError.gateway(
                    code: job.lastError?.code ?? "ACCEPTANCE_DRAFT_INCOMPLETE"
                )
            }

            let renameSuffix = " — title sync verified"
            let renamedTitle = reviewed.title.hasSuffix(renameSuffix)
                ? reviewed.title
                : "\(reviewed.title)\(renameSuffix)"
            let renamed = try repository.updateSessionTitle(
                sessionID: reviewed.sessionID,
                title: renamedTitle,
                now: Date()
            )
            try recorder.replaceReviewedSession(renamed)
            session = renamed
            guard let synchronized = await publisher.syncTitle(jobID: job.jobID),
                  synchronized.remoteTitle == renamedTitle,
                  synchronized.lastError == nil
            else {
                throw NativePublishError.gateway(code: "ACCEPTANCE_TITLE_SYNC_FAILED")
            }
            publishJob = synchronized
            writeProductionAcceptanceResult(
                [
                    "assetCount": synchronized.assetUploads?.count ?? 0,
                    "internalPublication": false,
                    "phase": synchronized.phase.rawValue,
                    "readerLink": "present",
                    "status": "pass",
                    "stepCount": renamed.steps.count,
                    "titleSynchronized": true,
                ],
                to: resultURL
            )
        } catch {
            let persisted = (try? repository.listJobs())?.last
            writeProductionAcceptanceResult(
                [
                    "code": persisted?.lastError?.code ?? "ACCEPTANCE_FAILED",
                    "phase": persisted?.phase.rawValue ?? "not_started",
                    "status": "fail",
                    "stage": "private_draft",
                ],
                to: resultURL
            )
        }
        NSApplication.shared.terminate(nil)
    }

    private func writeProductionAcceptanceResult(
        _ result: [String: Any],
        to url: URL
    ) {
        guard JSONSerialization.isValidJSONObject(result),
              let data = try? JSONSerialization.data(
                  withJSONObject: result,
                  options: [.sortedKeys]
              )
        else { return }
        try? data.write(to: url, options: .atomic)
    }

    var liveAtriumAvailable: Bool {
        publisher.capabilities.privateDrafts && atriumAuthentication == .signedIn
    }

    var atriumConfigured: Bool {
        localMockEnabled || productionSettings != nil
    }

    func openAtriumDraft() {
        guard
            let value = publishJob?.readerURL,
            let url = URL(string: value),
            url.scheme == "https",
            url.host == atriumProductionOrigin.host,
            url.port == nil,
            url.user == nil,
            url.password == nil,
            url.query == nil,
            url.fragment == nil,
            url.path.range(
                of: #"^/atrium/[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}/edit$"#,
                options: .regularExpression
            ) != nil
        else {
            statusCode = "ATRIUM_DRAFT_LINK_INVALID"
            return
        }
        NSWorkspace.shared.open(url)
    }

    func signInToAtrium() {
        guard let productionSettings else {
            statusCode = "ATRIUM_OAUTH_UNCONFIGURED"
            return
        }
        Task { @MainActor in
            do {
                _ = try await oauthCoordinator.signIn(configuration: productionSettings.oauth)
                atriumAuthentication = .signedIn
                statusCode = "ATRIUM_SIGNED_IN"
                await resumePendingPublications()
            } catch {
                atriumAuthentication = .signedOut
                statusCode = "ATRIUM_SIGN_IN_FAILED"
            }
        }
    }

    func signOutOfAtrium() {
        Task { @MainActor in
            do {
                try await oauthCoordinator.signOut(configuration: productionSettings?.oauth)
                atriumAuthentication = productionSettings == nil ? .unconfigured : .signedOut
                statusCode = "ATRIUM_SIGNED_OUT"
            } catch {
                statusCode = "ATRIUM_SIGN_OUT_FAILED"
            }
        }
    }

    func refreshPermissions() {
        permissions = MacPermissionCenter.snapshot()
    }

    func requestPermissions() {
        let requested = MacPermissionCenter.requestNextMissing()
        refreshPermissions()
        if permissions.screenRecording == .granted && permissions.accessibility == .granted {
            statusCode = "CAPTURE_ACCESS_READY"
        } else {
            statusCode = switch requested {
            case .screenRecording:
                "APPROVE_SCREEN_RECORDING_THEN_REOPEN"
            case .accessibility:
                "APPROVE_ACCESSIBILITY"
            case nil:
                "APPROVE_ACCESS_THEN_REOPEN"
            }
        }
    }

    func openScreenRecordingSettings() {
        MacPermissionCenter.openSettings(.screenRecording)
    }

    func openAccessibilitySettings() {
        MacPermissionCenter.openSettings(.accessibility)
    }

    func start() {
        refreshPermissions()
        guard permissions.screenRecording == .granted, permissions.accessibility == .granted else {
            statusCode = "CAPTURE_PERMISSIONS_REQUIRED"
            return
        }
        guard canStartRecording else {
            statusCode = "STOP_CURRENT_RECORDING_FIRST"
            return
        }
        do {
            try persistCurrentSession()
            screenshotImageCache.removeAll()
            publishJob = nil
            session = try recorder.start(
                appVersion: "1.0.0",
                osVersion: ProcessInfo.processInfo.operatingSystemVersionString
            )
            try persistCurrentSession()
            refreshGuides()
            monitor.start()
            statusCode = "RECORDING"
        } catch {
            statusCode = "RECORDER_START_FAILED"
        }
    }

    func newGuide() {
        guard canStartRecording else {
            statusCode = "STOP_CURRENT_RECORDING_FIRST"
            return
        }
        do {
            try persistCurrentSession()
            screenshotImageCache.removeAll()
            publishJob = nil
            _ = try recorder.start(
                title: "Untitled guide",
                appVersion: "1.0.0",
                osVersion: ProcessInfo.processInfo.operatingSystemVersionString
            )
            session = try recorder.stop()
            try persistCurrentSession()
            refreshGuides()
            statusCode = "NEW_GUIDE_READY"
        } catch {
            statusCode = "NEW_GUIDE_FAILED"
        }
    }

    func openGuide(sessionID: String) {
        guard session?.sessionID != sessionID else { return }
        guard canStartRecording else {
            statusCode = "STOP_CURRENT_RECORDING_FIRST"
            return
        }
        do {
            try persistCurrentSession()
            guard let selected = try repository.loadSession(sessionID: sessionID) else {
                statusCode = "GUIDE_NOT_FOUND"
                return
            }
            try recorder.activateStoredSession(selected)
            session = selected
            publishJob = try repository.listJobs().last(where: { $0.sessionID == sessionID })
            screenshotImageCache.removeAll()
            statusCode = "GUIDE_OPENED"
        } catch {
            statusCode = "GUIDE_OPEN_FAILED"
        }
    }

    func pauseOrResume() {
        do {
            if session?.state == .recording {
                session = try recorder.pause()
                statusCode = "PAUSED"
            } else if session?.state == .paused {
                session = try recorder.resume()
                statusCode = "RECORDING"
            }
            try persistCurrentSession()
            refreshGuides()
        } catch {
            statusCode = "RECORDER_TRANSITION_FAILED"
        }
    }

    func stop() {
        do {
            monitor.stop()
            session = try recorder.stop()
            try persistCurrentSession()
            refreshGuides()
            statusCode = "REVIEW_REQUIRED"
        } catch {
            statusCode = "RECORDER_STOP_FAILED"
        }
    }

    func screenshotImage(for step: StepElement) -> NSImage? {
        guard
            let session,
            let assetID = step.screenshotAssetID,
            let asset = session.assets.first(where: {
                $0.assetID == assetID && $0.state != .deleted
            })
        else {
            return nil
        }
        if let cached = screenshotImageCache[step.stepID],
           cached.assetID == assetID,
           cached.revision == session.revision {
            return cached.image
        }
        guard
            let source = try? vault.read(localKey: asset.localKey)
        else {
            return nil
        }
        let previewData: Data
        if asset.state == .rawLocal {
            guard let flattened = try? CoreGraphicsReviewRenderer.flatten(
                sourcePNG: source,
                crop: step.crop,
                annotations: step.annotations ?? []
            ) else {
                return nil
            }
            previewData = flattened.pngData
        } else {
            previewData = source
        }
        guard let image = NSImage(data: previewData) else { return nil }
        screenshotImageCache[step.stepID] = ScreenshotPreviewCacheEntry(
            assetID: assetID,
            revision: session.revision,
            image: image
        )
        return image
    }

    func editableImageBounds(for step: StepElement) -> NativeRect? {
        guard
            let assetID = step.screenshotAssetID,
            let asset = session?.assets.first(where: {
                $0.assetID == assetID && $0.state == .rawLocal
            })
        else {
            return nil
        }
        if let crop = step.crop {
            return NativeRect(
                x: crop.x,
                y: crop.y,
                width: crop.width,
                height: crop.height
            )
        }
        return NativeRect(
            x: 0,
            y: 0,
            width: Double(asset.pixelWidth),
            height: Double(asset.pixelHeight)
        )
    }

    func flattenAndApprove() {
        guard var reviewed = recorder.snapshot(), reviewed.state == .review else { return }
        do {
            try NativeReviewEditor.validatePrivacyAnnotations(in: reviewed)
            for asset in reviewed.assets where asset.state == .rawLocal {
                let source = try vault.read(localKey: asset.localKey)
                let step = reviewed.steps.first(where: { $0.screenshotAssetID == asset.assetID })
                let flattened = try CoreGraphicsReviewRenderer.flatten(
                    sourcePNG: source,
                    crop: step?.crop,
                    annotations: step?.annotations ?? []
                )
                let publishable = try vault.writePublishable(
                    pngData: flattened.pngData,
                    sessionID: reviewed.sessionID,
                    pixelWidth: flattened.pixelWidth,
                    pixelHeight: flattened.pixelHeight
                )
                reviewed = try NativeReviewEditor.markFlattened(
                    in: reviewed,
                    rawAssetID: asset.assetID,
                    publishable: publishable,
                    annotations: step?.annotations ?? []
                )
            }
            for step in reviewed.steps where step.privacyReview != .approved {
                reviewed = try NativeReviewEditor.approveStep(in: reviewed, stepID: step.stepID)
            }
            reviewed = try NativeReviewEditor.approveSession(reviewed)

            // The durable tombstone is persisted before raw files are removed. If
            // deletion is interrupted, the raw file remains non-publishable.
            try recorder.replaceReviewedSession(reviewed)
            try repository.saveSession(reviewed)
            for asset in reviewed.assets where asset.state == .deleted {
                try vault.delete(localKey: asset.localKey)
            }
            session = reviewed
            refreshGuides()
            statusCode = "PRIVACY_REVIEW_APPROVED"
        } catch {
            statusCode = "PRIVACY_REVIEW_FAILED"
        }
    }

    func publishPrivateDraft() {
        guard let session else { return }
        guard !currentSessionHasPublishJob, !publicationStarting else { return }
        publicationStarting = true
        statusCode = "PUBLISHING_PRIVATE_DRAFT"
        Task { @MainActor in
            defer { publicationStarting = false }
            do {
                var job = try await publisher.enqueue(
                    session: session,
                    collectionID: defaultCollectionID
                )
                if self.session?.sessionID == job.sessionID {
                    publishJob = job
                }
                job = try await publisher.resume(jobID: job.jobID)
                if self.session?.sessionID == job.sessionID {
                    publishJob = job
                    reloadActiveSessionFromRepository(sessionID: job.sessionID)
                    statusCode = job.phase == .readyAsDraft ? "PRIVATE_DRAFT_READY" : "PUBLISH_PENDING"
                }
                refreshGuides()
            } catch NativePublishError.capabilityUnavailable {
                statusCode = "ATRIUM_API_UNAVAILABLE"
            } catch {
                refreshPublishFailure(sessionID: session.sessionID)
            }
        }
    }

    func retryPublish() {
        guard let job = publishJob, job.lastError != nil else { return }
        statusCode = "RETRYING_ATRIUM_PUBLISH"
        Task { @MainActor in
            do {
                let resumed = try await publisher.retry(jobID: job.jobID)
                if session?.sessionID == resumed.sessionID {
                    publishJob = resumed
                    reloadActiveSessionFromRepository(sessionID: resumed.sessionID)
                    statusCode = resumed.phase == .readyAsDraft
                        ? "PRIVATE_DRAFT_READY"
                        : "PUBLISH_PENDING"
                }
                refreshGuides()
            } catch {
                refreshPublishFailure(sessionID: job.sessionID)
            }
        }
    }

    func publishInternally() {
        guard let job = publishJob, job.phase == .readyAsDraft else { return }
        statusCode = "PUBLISHING_INTERNAL"
        Task { @MainActor in
            do {
                let complete = try await publisher.resume(
                    jobID: job.jobID,
                    publishInternal: true
                )
                if self.session?.sessionID == complete.sessionID {
                    publishJob = complete
                    reloadActiveSessionFromRepository(sessionID: complete.sessionID)
                    statusCode = complete.phase == .complete
                        ? "INTERNAL_PUBLICATION_COMPLETE"
                        : "PUBLISH_PENDING"
                }
                refreshGuides()
            } catch {
                refreshPublishFailure(sessionID: job.sessionID)
            }
        }
    }

    private func resumePendingPublications() async {
        _ = await publisher.resumePending()
        if let sessionID = session?.sessionID,
           let latest = try? repository.listJobs().last(where: { $0.sessionID == sessionID }) {
            publishJob = latest
            reloadActiveSessionFromRepository(sessionID: sessionID)
            switch latest.phase {
            case .readyAsDraft:
                statusCode = "PRIVATE_DRAFT_READY"
            case .complete:
                statusCode = "INTERNAL_PUBLICATION_COMPLETE"
            case .needsAttention:
                statusCode = "PUBLISH_NEEDS_ATTENTION"
            default:
                statusCode = latest.lastError.map {
                    "PUBLISH_FAILED_\($0.code)"
                } ?? "PUBLISH_PENDING"
            }
        }
        refreshGuides()
    }

    func captureRegion() {
        guard canQuickCapture else {
            statusCode = "STOP_RECORDING_BEFORE_QUICK_CAPTURE"
            return
        }
        refreshPermissions()
        guard permissions.screenRecording == .granted else {
            statusCode = "SCREEN_RECORDING_PERMISSION_REQUIRED"
            return
        }
        Task { @MainActor in
            do {
                let region = try await regionSelector.selectRegion()
                let frame = try await capture.capture(
                    request: NativeCaptureRequest(
                        eventID: UUID().uuidString,
                        bounds: region,
                        regionOnly: true
                    )
                )
                try commitQuickCapture(
                    frame: frame,
                    event: NativeSemanticEvent(
                        eventID: UUID().uuidString.lowercased(),
                        occurredAt: Date(),
                        action: .manual,
                        accessibilityRole: nil,
                        accessibleName: "Selected region",
                        bounds: region,
                        appName: "Desktop",
                        bundleID: "org.apple.desktop",
                        windowTitle: nil,
                        backingScaleFactor: frame.backingScaleFactor
                    ),
                    title: "Region capture"
                )
            } catch RegionSelectionError.cancelled {
                statusCode = "REGION_CAPTURE_CANCELLED"
            } catch {
                statusCode = "REGION_CAPTURE_FAILED"
            }
        }
    }

    func captureElement() {
        guard canQuickCapture else {
            statusCode = "STOP_RECORDING_BEFORE_QUICK_CAPTURE"
            return
        }
        refreshPermissions()
        guard permissions.screenRecording == .granted, permissions.accessibility == .granted else {
            statusCode = "CAPTURE_PERMISSIONS_REQUIRED"
            return
        }
        guard let event = reader.focusedEvent(action: .click), let bounds = event.bounds else {
            statusCode = "ACCESSIBLE_ELEMENT_UNAVAILABLE"
            return
        }
        guard !event.isSensitiveField else {
            statusCode = "SENSITIVE_FIELD_BLOCKED"
            return
        }
        Task { @MainActor in
            do {
                let frame = try await capture.capture(
                    request: NativeCaptureRequest(eventID: event.eventID, bounds: bounds, regionOnly: true)
                )
                try commitQuickCapture(frame: frame, event: event, title: "Element capture")
            } catch {
                statusCode = "ELEMENT_CAPTURE_FAILED"
            }
        }
    }

    func addAnnotation(
        stepID: String,
        kind: Kind,
        geometry: Geometry,
        arrowDirection: ArrowDirection? = nil,
        text: String? = nil
    ) {
        guard requireGuideContentEditable() else { return }
        guard var current = recorder.snapshot(),
              let step = current.steps.first(where: { $0.stepID == stepID }),
              let assetID = step.screenshotAssetID,
              current.assets.contains(where: { $0.assetID == assetID && $0.state == .rawLocal })
        else { return }
        let cleanText = String(
            (text ?? "")
                .trimmingCharacters(in: .whitespacesAndNewlines)
                .prefix(300)
        )
        let annotation = AnnotationElement(
            arrowDirection: kind == .arrow ? arrowDirection : nil,
            color: annotationColor(kind),
            geometry: geometry,
            id: UUID().uuidString.lowercased(),
            kind: kind,
            text: kind == .text ? (cleanText.isEmpty ? "Annotation" : cleanText) : nil
        )
        do {
            current = try NativeReviewEditor.setAnnotations(
                in: current,
                stepID: stepID,
                annotations: (step.annotations ?? []) + [annotation]
            )
            try recorder.replaceReviewedSession(current)
            try repository.saveSession(current)
            session = current
            refreshGuides()
            statusCode = "ANNOTATION_ADDED"
        } catch {
            statusCode = "ANNOTATION_FAILED"
        }
    }

    func undoLastAnnotation(stepID: String) {
        guard requireGuideContentEditable() else { return }
        guard let current = recorder.snapshot(),
              let step = current.steps.first(where: { $0.stepID == stepID }),
              var annotations = step.annotations,
              !annotations.isEmpty
        else { return }
        annotations.removeLast()
        applyReviewMutation {
            try NativeReviewEditor.setAnnotations(
                in: current,
                stepID: stepID,
                annotations: annotations
            )
        }
    }

    func updateInstruction(stepID: String, text: String) {
        guard requireGuideContentEditable() else { return }
        guard let current = recorder.snapshot() else { return }
        do {
            let updated = try NativeReviewEditor.setInstruction(in: current, stepID: stepID, text: text)
            try recorder.replaceReviewedSession(updated)
            try repository.saveSession(updated)
            session = updated
            refreshGuides()
        } catch {
            statusCode = "INSTRUCTION_EDIT_FAILED"
        }
    }

    func setCenterCrop(stepID: String) {
        guard requireGuideContentEditable() else { return }
        guard let current = recorder.snapshot(),
              let step = current.steps.first(where: { $0.stepID == stepID }),
              let assetID = step.screenshotAssetID,
              let asset = current.assets.first(where: { $0.assetID == assetID && $0.state == .rawLocal })
        else { return }
        let crop = NativeRect(
            x: Double(asset.pixelWidth) * 0.1,
            y: Double(asset.pixelHeight) * 0.1,
            width: Double(asset.pixelWidth) * 0.8,
            height: Double(asset.pixelHeight) * 0.8
        )
        do {
            let updated = try NativeReviewEditor.setCrop(in: current, stepID: stepID, crop: crop)
            try recorder.replaceReviewedSession(updated)
            try repository.saveSession(updated)
            session = updated
            refreshGuides()
            statusCode = "CROP_UPDATED"
        } catch {
            statusCode = "CROP_FAILED"
        }
    }

    func resetCrop(stepID: String) {
        guard requireGuideContentEditable() else { return }
        guard let current = recorder.snapshot() else { return }
        do {
            let updated = try NativeReviewEditor.setCrop(in: current, stepID: stepID, crop: nil)
            try recorder.replaceReviewedSession(updated)
            try repository.saveSession(updated)
            session = updated
            refreshGuides()
            statusCode = "CROP_RESET"
        } catch {
            statusCode = "CROP_FAILED"
        }
    }

    func moveStep(stepID: String, offset: Int) {
        guard requireGuideContentEditable() else { return }
        guard let current = recorder.snapshot(),
              let index = current.steps.firstIndex(where: { $0.stepID == stepID })
        else { return }
        applyReviewMutation {
            try NativeReviewEditor.moveStep(
                in: current,
                stepID: stepID,
                toIndex: index + offset
            )
        }
    }

    func deleteStep(stepID: String) {
        guard requireGuideContentEditable() else { return }
        guard let current = recorder.snapshot() else { return }
        applyReviewMutation { try NativeReviewEditor.deleteStep(in: current, stepID: stepID) }
    }

    func mergeStepWithNext(stepID: String) {
        guard requireGuideContentEditable() else { return }
        guard let current = recorder.snapshot() else { return }
        applyReviewMutation { try NativeReviewEditor.mergeStepWithNext(in: current, stepID: stepID) }
    }

    func insertManualStep() {
        guard requireGuideContentEditable() else { return }
        guard let current = recorder.snapshot(),
              !manualInstruction.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
        else {
            return
        }
        applyReviewMutation {
            try NativeReviewEditor.insertManualStep(
                in: current,
                afterStepID: current.steps.last?.stepID,
                text: manualInstruction
            )
        }
        manualInstruction = ""
    }

    func updateTitle(_ title: String) {
        guard canEditGuideTitle, let current = recorder.snapshot() else {
            statusCode = "GUIDE_TITLE_UNAVAILABLE"
            return
        }
        do {
            let now = Date()
            if let job = try repository.listJobs().last(where: {
                $0.sessionID == current.sessionID
            }) {
                _ = try repository.freezeCreateTitle(
                    jobID: job.jobID,
                    title: current.title,
                    now: now
                )
            }
            let updated = try repository.updateSessionTitle(
                sessionID: current.sessionID,
                title: title,
                now: now
            )
            try recorder.replaceReviewedSession(updated)
            session = updated
            refreshGuides()
            guard let job = try repository.listJobs().last(where: {
                $0.sessionID == updated.sessionID
            }) else {
                statusCode = "GUIDE_TITLE_SAVED"
                return
            }
            publishJob = job
            guard job.contentObjectID != nil else {
                statusCode = "GUIDE_TITLE_SAVED_PENDING_DRAFT"
                return
            }
            guard liveAtriumAvailable else {
                statusCode = "GUIDE_TITLE_SAVED_PENDING_SIGN_IN"
                return
            }
            statusCode = "SYNCING_GUIDE_TITLE"
            Task { @MainActor in
                guard let synced = await publisher.syncTitle(jobID: job.jobID) else {
                    statusCode = "GUIDE_TITLE_SYNC_PENDING"
                    return
                }
                if session?.sessionID == synced.sessionID {
                    publishJob = synced
                    statusCode = synced.remoteTitle == session?.title
                        ? "GUIDE_TITLE_SYNCED"
                        : "GUIDE_TITLE_SYNC_PENDING"
                }
            }
        } catch {
            statusCode = "GUIDE_TITLE_INVALID"
        }
    }

    func setLaunchAtLogin(_ enabled: Bool) {
        do {
            if enabled {
                try SMAppService.mainApp.register()
            } else {
                try SMAppService.mainApp.unregister()
            }
            refreshLaunchAtLoginState()
            statusCode = launchAtLoginState == .requiresApproval
                ? "APPROVE_START_AT_LOGIN"
                : "START_AT_LOGIN_UPDATED"
        } catch {
            refreshLaunchAtLoginState()
            statusCode = "START_AT_LOGIN_UPDATE_FAILED"
        }
    }

    func openLoginItemSettings() {
        SMAppService.openSystemSettingsLoginItems()
    }

    func pinFirstReviewedImage() {
        guard let session,
              let asset = session.assets.first(where: { $0.state == .publishableLocal })
        else {
            statusCode = "APPROVE_IMAGE_BEFORE_PINNING"
            return
        }
        do {
            let data = try vault.read(localKey: asset.localKey)
            let pinAsset = try vault.writePin(
                pngData: data,
                pixelWidth: asset.pixelWidth,
                pixelHeight: asset.pixelHeight
            )
            let aspect = Double(asset.pixelWidth) / Double(asset.pixelHeight)
            let pin = PinnedCapture(
                id: pinAsset.assetID,
                localKey: pinAsset.localKey,
                title: session.title,
                frame: NativeRect(x: 40, y: 60, width: 420, height: max(120, 420 / aspect)),
                displayID: CGMainDisplayID(),
                clickThrough: false,
                groupID: nil,
                createdAt: Date(),
                byteCount: data.count
            )
            let evicted = try pinBoard.add(pin)
            for key in evicted { try? vault.delete(localKey: key) }
            pins = pinBoard.snapshot().pins
            pinWindows.show(pin: pin, pngData: data)
            clipboard.copyPNG(data, retention: pinBoard.snapshot().clipboardRetention)
            statusCode = "PIN_CREATED"
        } catch {
            statusCode = "PIN_CREATE_FAILED"
        }
    }

    func setPinClickThrough(_ pin: PinnedCapture, enabled: Bool) {
        do {
            try pinBoard.setClickThrough(pinID: pin.id, enabled: enabled)
            pins = pinBoard.snapshot().pins
            pinWindows.setClickThrough(pinID: pin.id, enabled: enabled)
        } catch {
            statusCode = "PIN_UPDATE_FAILED"
        }
    }

    private func persistPinFrame(pinID: String, frame: NativeRect, displayID: UInt32) {
        do {
            try pinBoard.setFrame(pinID: pinID, frame: frame, displayID: displayID)
            pins = pinBoard.snapshot().pins
        } catch {
            statusCode = "PIN_FRAME_PERSIST_FAILED"
        }
    }

    func setPinGroup(_ pin: PinnedCapture, group: String) {
        do {
            try pinBoard.setGroup(pinID: pin.id, groupID: group.isEmpty ? nil : group)
            pins = pinBoard.snapshot().pins
        } catch {
            statusCode = "PIN_UPDATE_FAILED"
        }
    }

    func removePin(_ pin: PinnedCapture) {
        do {
            let key = try pinBoard.remove(pinID: pin.id)
            try vault.delete(localKey: key)
            pinWindows.close(pinID: pin.id)
            pins = pinBoard.snapshot().pins
        } catch {
            statusCode = "PIN_REMOVE_FAILED"
        }
    }

    func setClipboardRetention(_ retention: ClipboardRetention) {
        do {
            try pinBoard.setClipboardRetention(retention)
            statusCode = "CLIPBOARD_RETENTION_UPDATED"
        } catch {
            statusCode = "CLIPBOARD_RETENTION_FAILED"
        }
    }

    private func commitQuickCapture(
        frame: NativeCapturedFrame,
        event: NativeSemanticEvent,
        title: String
    ) throws {
        let existing = recorder.snapshot()
        let appending = existing.map {
            ($0.state == .review || $0.state == .publishable) && !currentGuideContentFrozen
        } ?? false
        let targetSession: AtriumCaptureSession
        if appending, let existing {
            targetSession = existing
        } else {
            try persistCurrentSession()
            publishJob = nil
            targetSession = try recorder.start(
                title: title,
                appVersion: "1.0.0",
                osVersion: ProcessInfo.processInfo.operatingSystemVersionString
            )
        }
        let asset = try vault.writeRaw(frame: frame, sessionID: targetSession.sessionID)
        do {
            if appending {
                _ = try recorder.appendCaptureForReview(event, screenshot: asset)
                session = recorder.snapshot()
                try persistCurrentSession()
                refreshGuides()
                statusCode = "CAPTURE_ADDED_TO_GUIDE"
            } else {
                _ = try recorder.record(event, screenshot: asset)
                session = try recorder.stop()
                try persistCurrentSession()
                refreshGuides()
                statusCode = "REVIEW_REQUIRED"
            }
        } catch {
            try? vault.delete(localKey: asset.localKey)
            throw error
        }
    }

    private func handlePermissionChange() {
        let next = MacPermissionCenter.snapshot()
        guard next != permissions else { return }
        permissions = next
        if session?.state == .recording,
           (next.screenRecording != .granted || next.accessibility != .granted) {
            monitor.stop()
            session = try? recorder.pause()
            try? persistCurrentSession()
            refreshGuides()
            statusCode = "PERMISSION_REVOKED_CAPTURE_PAUSED"
        }
    }

    private func applyReviewMutation(_ operation: () throws -> AtriumCaptureSession) {
        do {
            let updated = try operation()
            try recorder.replaceReviewedSession(updated)
            for asset in updated.assets where asset.state == .deleted {
                try? vault.delete(localKey: asset.localKey)
            }
            session = updated
            try repository.saveSession(updated)
            refreshGuides()
            statusCode = "REVIEW_UPDATED"
        } catch {
            statusCode = "REVIEW_UPDATE_FAILED"
        }
    }

    private func refreshPublishFailure(sessionID: String) {
        guard let jobs = try? repository.listJobs(),
              let latest = jobs.last(where: { $0.sessionID == sessionID })
        else {
            if session?.sessionID == sessionID {
                statusCode = "PUBLISH_RETRY_REQUIRED"
            }
            return
        }
        guard session?.sessionID == sessionID else { return }
        publishJob = latest
        if let code = latest.lastError?.code {
            statusCode = latest.phase == .needsAttention
                ? "PUBLISH_NEEDS_ATTENTION_\(code)"
                : "PUBLISH_FAILED_\(code)"
        } else {
            statusCode = "PUBLISH_RETRY_REQUIRED"
        }
    }

    private func persistCurrentSession() throws {
        guard let current = recorder.snapshot() else { return }
        let canonical = try repository.reconcileSession(current)
        try recorder.replaceReviewedSession(canonical)
        session = canonical
    }

    private func reloadActiveSessionFromRepository(sessionID: String) {
        guard session?.sessionID == sessionID,
              let stored = try? repository.loadSession(sessionID: sessionID)
        else { return }
        try? recorder.replaceReviewedSession(stored)
        session = stored
    }

    private func requireGuideContentEditable() -> Bool {
        guard canEditGuideContent else {
            statusCode = currentSessionHasPublishJob
                ? "GUIDE_CONTENT_FROZEN_AFTER_DRAFT"
                : "GUIDE_CONTENT_REQUIRES_REVIEW"
            return false
        }
        return true
    }

    private func refreshGuides() {
        guides = (try? repository.listSessions()) ?? guides
    }

    private func refreshLaunchAtLoginState() {
        launchAtLoginState = switch SMAppService.mainApp.status {
        case .notRegistered:
            .disabled
        case .enabled:
            .enabled
        case .requiresApproval:
            .requiresApproval
        case .notFound:
            .unavailable
        @unknown default:
            .unavailable
        }
    }

    private func annotationColor(_ kind: Kind) -> String {
        switch kind {
        case .redaction, .blur, .mosaic:
            "#000000"
        case .highlight, .rectangle, .arrow, .text:
            "#FFD400"
        }
    }
}

@main
struct AtriumCaptureMacApplication: App {
    @StateObject private var model = CaptureAppModel()

    var body: some Scene {
        Window("Atrium Capture", id: "workspace") {
            AtriumCaptureWorkspaceView(model: model)
        }
        .defaultSize(width: 1080, height: 720)

        MenuBarExtra("Atrium Capture", systemImage: "viewfinder") {
            AtriumCaptureMenuBarView(model: model)
        }

        Settings {
            AtriumCaptureSettingsView(model: model)
        }
    }
}

private struct AtriumCaptureMenuBarView: View {
    @ObservedObject var model: CaptureAppModel
    @Environment(\.openWindow) private var openWindow

    var body: some View {
        Button("Show Atrium Capture") {
            showWorkspace()
        }

        Divider()

        Button("Capture Region") {
            model.captureRegion()
        }
        .keyboardShortcut("a", modifiers: [.option, .command])
        .disabled(!model.canQuickCapture)

        Button("Capture Focused Element") {
            model.captureElement()
        }
        .keyboardShortcut("e", modifiers: [.option, .command])
        .disabled(!model.canQuickCapture)

        if model.session?.state == .recording || model.session?.state == .paused {
            Button(model.session?.state == .paused ? "Resume Recording" : "Pause Recording") {
                model.pauseOrResume()
            }
            Button("Stop and Review") {
                model.stop()
                showWorkspace()
            }
        } else {
            Button("Start New Recording") {
                model.start()
                showWorkspace()
            }
            .disabled(!model.canStartRecording)
            Button("New Empty Guide") {
                model.newGuide()
                showWorkspace()
            }
            .disabled(!model.canStartRecording)
            if model.guides.count > 1 {
                Menu("Open Saved Guide") {
                    ForEach(model.guides, id: \.sessionID) { guide in
                        Button(guide.title) {
                            model.openGuide(sessionID: guide.sessionID)
                            showWorkspace()
                        }
                        .disabled(
                            guide.sessionID == model.session?.sessionID
                                || model.session?.state == .recording
                                || model.session?.state == .paused
                        )
                    }
                }
            }
        }

        Divider()

        Toggle(
            "Start at Login",
            isOn: Binding(
                get: { model.launchAtLoginEnabled },
                set: { model.setLaunchAtLogin($0) }
            )
        )
        .disabled(!model.launchAtLoginAvailable)

        if model.launchAtLoginState == .requiresApproval {
            Button("Approve in Login Items…") {
                model.openLoginItemSettings()
            }
        }

        Divider()

        Button("Quit Atrium Capture") {
            NSApplication.shared.terminate(nil)
        }
    }

    private func showWorkspace() {
        NSApplication.shared.activate(ignoringOtherApps: true)
        openWindow(id: "workspace")
    }
}

private struct AtriumCaptureSettingsView: View {
    @ObservedObject var model: CaptureAppModel

    var body: some View {
        Form {
            Toggle(
                "Start Atrium Capture at login",
                isOn: Binding(
                    get: { model.launchAtLoginEnabled },
                    set: { model.setLaunchAtLogin($0) }
                )
            )
            .disabled(!model.launchAtLoginAvailable)

            if model.launchAtLoginState == .requiresApproval {
                Text("macOS requires approval before Atrium Capture can start automatically.")
                    .foregroundStyle(.secondary)
                Button("Open Login Items Settings") {
                    model.openLoginItemSettings()
                }
            } else if !model.launchAtLoginAvailable {
                Text("Start at login is available from the installed Atrium Capture app.")
                    .foregroundStyle(.secondary)
            }
        }
        .formStyle(.grouped)
        .padding()
        .frame(width: 430)
    }
}
#else
@main
enum AtriumCaptureMacApplication {
    static func main() {
        print("AtriumCaptureMacApp requires macOS 14 or later.")
    }
}
#endif
