import AtriumCaptureContracts
import AtriumCaptureCore
import AtriumCaptureMacPlatform
import Foundation

#if os(macOS)
import AppKit
import CoreGraphics
import SwiftUI

@MainActor
final class CaptureAppModel: ObservableObject {
    @Published private(set) var session: AtriumCaptureSession?
    @Published private(set) var permissions = MacPermissionCenter.snapshot()
    @Published private(set) var statusCode = "READY"
    @Published private(set) var publishJob: AtriumCapturePublishJob?
    @Published private(set) var pins: [PinnedCapture] = []
    @Published private(set) var atriumAuthentication: NativeAuthenticationStatus = .unconfigured
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
            publishJob = persistedJob
            session = try persistedJob.flatMap {
                try repository.loadSession(sessionID: $0.sessionID)
            } ?? recorder.snapshot()
            if let persistedJob {
                switch persistedJob.phase {
                case .readyAsDraft:
                    statusCode = "PRIVATE_DRAFT_READY"
                case .complete:
                    statusCode = "INTERNAL_PUBLICATION_COMPLETE"
                case .needsAttention:
                    statusCode = "PUBLISH_NEEDS_ATTENTION"
                default:
                    statusCode = "PUBLISH_PENDING"
                }
            }
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
        _ = MacPermissionCenter.requestAccessibilityPrompt()
        _ = MacPermissionCenter.requestScreenRecording()
        refreshPermissions()
        statusCode = permissions.screenRecording == .granted && permissions.accessibility == .granted
            ? "CAPTURE_ACCESS_READY"
            : "APPROVE_ACCESS_THEN_REOPEN"
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
        do {
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
        statusCode = "PUBLISHING_PRIVATE_DRAFT"
        Task { @MainActor in
            do {
                var job = try await publisher.enqueue(
                    session: session,
                    collectionID: defaultCollectionID
                )
                job = try await publisher.resume(jobID: job.jobID)
                publishJob = job
                self.session = try? repository.loadSession(sessionID: job.sessionID)
                statusCode = job.phase == .readyAsDraft ? "PRIVATE_DRAFT_READY" : "PUBLISH_PENDING"
            } catch NativePublishError.capabilityUnavailable {
                statusCode = "ATRIUM_API_UNAVAILABLE"
            } catch {
                statusCode = "PUBLISH_RETRY_REQUIRED"
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
                statusCode = "PUBLISH_RETRY_REQUIRED"
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
                statusCode = "PUBLISH_RETRY_REQUIRED"
            }
        }
    }

    func captureRegion() {
        guard session?.state != .recording, session?.state != .paused else {
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
        guard session?.state != .recording, session?.state != .paused else {
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

    func addAnnotation(stepID: String, kind: Kind) {
        guard var current = recorder.snapshot(),
              let step = current.steps.first(where: { $0.stepID == stepID }),
              let assetID = step.screenshotAssetID,
              let asset = current.assets.first(where: { $0.assetID == assetID && $0.state == .rawLocal })
        else { return }
        let width = min(220.0, Double(asset.pixelWidth) * 0.35)
        let height = min(90.0, Double(asset.pixelHeight) * 0.2)
        let geometry = Geometry(
            height: max(20, height),
            width: max(20, width),
            x: max(0, (Double(asset.pixelWidth) - width) / 2),
            y: max(0, (Double(asset.pixelHeight) - height) / 2)
        )
        let annotation = AnnotationElement(
            color: kind == .redaction ? "#000000" : "#FFD400",
            geometry: geometry,
            id: UUID().uuidString.lowercased(),
            kind: kind,
            text: kind == .text ? "Annotation" : nil
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

    func updateInstruction(stepID: String, text: String) {
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
        guard let current = recorder.snapshot(), !manualInstruction.trimmingCharacters(in: .whitespaces).isEmpty else {
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
        let started = try recorder.start(
            title: title,
            appVersion: "1.0.0",
            osVersion: ProcessInfo.processInfo.operatingSystemVersionString
        )
        let asset = try vault.writeRaw(frame: frame, sessionID: started.sessionID)
        _ = try recorder.record(event, screenshot: asset)
        session = try recorder.stop()
        statusCode = "REVIEW_REQUIRED"
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
}

@main
struct AtriumCaptureMacApplication: App {
    @StateObject private var model = CaptureAppModel()

    var body: some Scene {
        WindowGroup("Atrium Capture") {
            AtriumCaptureWorkspaceView(model: model)
        }
        .defaultSize(width: 1080, height: 720)
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
