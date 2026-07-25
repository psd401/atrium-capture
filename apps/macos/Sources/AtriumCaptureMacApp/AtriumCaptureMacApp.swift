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

    var currentGuideLockedForPublish: Bool {
        publicationStarting || currentSessionHasPublishJob
    }

    var hasUnfinishedPublishJob: Bool {
        if publicationStarting { return true }
        guard currentSessionHasPublishJob, let phase = publishJob?.phase else { return false }
        return phase != .readyAsDraft && phase != .complete
    }

    var canRetryPublish: Bool {
        currentSessionHasPublishJob
            && publishJob?.lastError?.retryable == true
            && publishJob?.phase != .needsAttention
    }

    var canEditGuideContent: Bool {
        guard !currentGuideLockedForPublish, let state = session?.state else { return false }
        return state == .review || state == .publishable
    }

    var canEditGuideTitle: Bool {
        canEditGuideContent
    }

    var canStartRecording: Bool {
        guard let session else { return true }
        if currentGuideLockedForPublish {
            return publishJob?.phase == .complete
        }
        return session.state == .submitted || session.state == .archived
    }

    var canQuickCapture: Bool {
        guard let session else { return true }
        if session.state == .recording || session.state == .paused {
            return false
        }
        if currentGuideLockedForPublish {
            return publishJob?.phase == .complete
        }
        return session.state == .review
            || session.state == .publishable
            || session.state == .submitted
            || session.state == .archived
    }

    var launchAtLoginEnabled: Bool {
        launchAtLoginState == .enabled
    }

    var launchAtLoginAvailable: Bool {
        launchAtLoginState != .unavailable
    }

    var publishFailureGuidance: String? {
        guard let job = publishJob, let failure = job.lastError else { return nil }
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
            : "Contact district support with the code below."
        return "\(action) \(next)"
    }

    init() {
        do {
            let root = try MacApplicationSupport.rootURL()
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
            let localMockEnabled = ProcessInfo.processInfo.environment["ATRIUM_CAPTURE_LOCAL_MOCK"] == "1"
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
            let persistedJob = try repository.listJobs().last
            let recorderSession = recorder.snapshot()
            let shouldRestorePublishedSession = persistedJob.map { job in
                job.phase != .complete
                    || recorderSession == nil
                    || recorderSession?.sessionID == job.sessionID
            } ?? false
            if shouldRestorePublishedSession, let persistedJob {
                publishJob = persistedJob
                session = try repository.loadSession(sessionID: persistedJob.sessionID)
                    ?? recorderSession
                switch persistedJob.phase {
                case .readyAsDraft:
                    statusCode = "PRIVATE_DRAFT_READY"
                case .complete:
                    statusCode = "INTERNAL_PUBLICATION_COMPLETE"
                case .needsAttention:
                    statusCode = "PUBLISH_NEEDS_ATTENTION"
                default:
                    statusCode = persistedJob.lastError.map {
                        "PUBLISH_FAILED_\($0.code)"
                    } ?? "PUBLISH_PENDING"
                }
            } else {
                publishJob = nil
                session = recorderSession
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
                    self?.atriumAuthentication = await oauthCoordinator.status(
                        configuration: productionSettings.oauth
                    )
                    if self?.atriumAuthentication == .signedIn {
                        await self?.resumePendingPublications()
                    }
                }
            }
        } catch {
            fatalError("Atrium Capture could not initialize local storage.")
        }
    }

    var liveAtriumAvailable: Bool {
        publisher.capabilities.privateDrafts && atriumAuthentication == .signedIn
    }

    var atriumConfigured: Bool {
        localMockEnabled || productionSettings != nil
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
            statusCode = currentGuideLockedForPublish
                ? "FINISH_CURRENT_ATRIUM_DRAFT_FIRST"
                : "FINISH_CURRENT_GUIDE_FIRST"
            return
        }
        do {
            screenshotImageCache.removeAll()
            publishJob = nil
            session = try recorder.start(
                appVersion: "1.0.0",
                osVersion: ProcessInfo.processInfo.operatingSystemVersionString
            )
            monitor.start()
            statusCode = "RECORDING"
        } catch {
            statusCode = "RECORDER_START_FAILED"
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
        } catch {
            statusCode = "RECORDER_TRANSITION_FAILED"
        }
    }

    func stop() {
        do {
            monitor.stop()
            session = try recorder.stop()
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
            statusCode = "PRIVACY_REVIEW_APPROVED"
        } catch {
            statusCode = "PRIVACY_REVIEW_FAILED"
        }
    }

    func publishPrivateDraft() {
        guard let session else { return }
        guard !currentGuideLockedForPublish else { return }
        publicationStarting = true
        statusCode = "PUBLISHING_PRIVATE_DRAFT"
        Task { @MainActor in
            defer { publicationStarting = false }
            do {
                var job = try await publisher.enqueue(
                    session: session,
                    collectionID: defaultCollectionID
                )
                publishJob = job
                job = try await publisher.resume(jobID: job.jobID)
                publishJob = job
                self.session = try? repository.loadSession(sessionID: job.sessionID)
                statusCode = job.phase == .readyAsDraft ? "PRIVATE_DRAFT_READY" : "PUBLISH_PENDING"
            } catch NativePublishError.capabilityUnavailable {
                statusCode = "ATRIUM_API_UNAVAILABLE"
            } catch {
                refreshPublishFailure(sessionID: session.sessionID)
            }
        }
    }

    func retryPublish() {
        guard let job = publishJob, job.lastError?.retryable == true else { return }
        statusCode = "RETRYING_ATRIUM_PUBLISH"
        Task { @MainActor in
            do {
                let resumed = try await publisher.resume(jobID: job.jobID)
                publishJob = resumed
                session = try? repository.loadSession(sessionID: resumed.sessionID)
                statusCode = resumed.phase == .readyAsDraft
                    ? "PRIVATE_DRAFT_READY"
                    : "PUBLISH_PENDING"
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
                publishJob = complete
                self.session = try? repository.loadSession(sessionID: complete.sessionID)
                statusCode = complete.phase == .complete
                    ? "INTERNAL_PUBLICATION_COMPLETE"
                    : "PUBLISH_PENDING"
            } catch {
                refreshPublishFailure(sessionID: job.sessionID)
            }
        }
    }

    private func resumePendingPublications() async {
        let recovered = await publisher.resumePending()
        if let latest = recovered.last {
            publishJob = latest
            session = try? repository.loadSession(sessionID: latest.sessionID)
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
    }

    func captureRegion() {
        guard canQuickCapture else {
            statusCode = currentGuideLockedForPublish
                ? "CURRENT_GUIDE_LOCKED_AFTER_PUBLISH"
                : "STOP_RECORDING_BEFORE_QUICK_CAPTURE"
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
            statusCode = currentGuideLockedForPublish
                ? "CURRENT_GUIDE_LOCKED_AFTER_PUBLISH"
                : "STOP_RECORDING_BEFORE_QUICK_CAPTURE"
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
            session = current
            statusCode = "ANNOTATION_ADDED"
        } catch {
            statusCode = "ANNOTATION_FAILED"
        }
    }

    func undoLastAnnotation(stepID: String) {
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
        guard canEditGuideContent else {
            statusCode = "CURRENT_GUIDE_LOCKED_AFTER_PUBLISH"
            return
        }
        guard let current = recorder.snapshot() else { return }
        do {
            let updated = try NativeReviewEditor.setInstruction(in: current, stepID: stepID, text: text)
            try recorder.replaceReviewedSession(updated)
            session = updated
        } catch {
            statusCode = "INSTRUCTION_EDIT_FAILED"
        }
    }

    func setCenterCrop(stepID: String) {
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
            session = updated
            statusCode = "CROP_UPDATED"
        } catch {
            statusCode = "CROP_FAILED"
        }
    }

    func resetCrop(stepID: String) {
        guard let current = recorder.snapshot() else { return }
        do {
            let updated = try NativeReviewEditor.setCrop(in: current, stepID: stepID, crop: nil)
            try recorder.replaceReviewedSession(updated)
            session = updated
            statusCode = "CROP_RESET"
        } catch {
            statusCode = "CROP_FAILED"
        }
    }

    func moveStep(stepID: String, offset: Int) {
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
        guard let current = recorder.snapshot() else { return }
        applyReviewMutation { try NativeReviewEditor.deleteStep(in: current, stepID: stepID) }
    }

    func mergeStepWithNext(stepID: String) {
        guard let current = recorder.snapshot() else { return }
        applyReviewMutation { try NativeReviewEditor.mergeStepWithNext(in: current, stepID: stepID) }
    }

    func insertManualStep() {
        guard canEditGuideContent else {
            statusCode = "CURRENT_GUIDE_LOCKED_AFTER_PUBLISH"
            return
        }
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
            statusCode = "CURRENT_GUIDE_LOCKED_AFTER_PUBLISH"
            return
        }
        do {
            let updated = try NativeReviewEditor.setTitle(in: current, title: title)
            try recorder.replaceReviewedSession(updated)
            session = updated
            statusCode = "GUIDE_TITLE_SAVED"
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
            ($0.state == .review || $0.state == .publishable) && !currentGuideLockedForPublish
        } ?? false
        let targetSession: AtriumCaptureSession
        if appending, let existing {
            targetSession = existing
        } else {
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
                statusCode = "CAPTURE_ADDED_TO_GUIDE"
            } else {
                _ = try recorder.record(event, screenshot: asset)
                session = try recorder.stop()
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
            statusCode = "REVIEW_UPDATED"
        } catch {
            statusCode = "REVIEW_UPDATE_FAILED"
        }
    }

    private func refreshPublishFailure(sessionID: String) {
        guard let jobs = try? repository.listJobs(),
              let latest = jobs.last(where: { $0.sessionID == sessionID })
        else {
            statusCode = "PUBLISH_RETRY_REQUIRED"
            return
        }
        publishJob = latest
        if let code = latest.lastError?.code {
            statusCode = latest.phase == .needsAttention
                ? "PUBLISH_NEEDS_ATTENTION_\(code)"
                : "PUBLISH_FAILED_\(code)"
        } else {
            statusCode = "PUBLISH_RETRY_REQUIRED"
        }
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
