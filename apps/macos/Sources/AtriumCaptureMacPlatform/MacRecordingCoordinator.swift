import AtriumCaptureContracts
import AtriumCaptureCore
import Foundation

public protocol NativeSemanticEventReading: Sendable {
    func focusedEvent(
        action: NativeCaptureAction,
        occurredAt: Date
    ) -> NativeSemanticEvent?
}

public enum MacCaptureIssueCode: String, Equatable, Sendable {
    case eventPersistenceFailed
    case screenshotFailed
    case semanticContextUnavailable
}

/// Fixed counters only: no window titles, control names, framework errors, or
/// other potentially sensitive capture context may enter diagnostics.
public struct MacCaptureDiagnostics: Equatable, Sendable {
    public let acceptedEvents: Int
    public let capturedImages: Int
    public let recordedSteps: Int
    public let mergedEvents: Int
    public let pendingEvents: Int
    public let screenshotFailures: Int
    public let screenshotRetries: Int
    public let semanticSkips: Int
    public let sensitiveSkips: Int
    public let eventPersistenceFailures: Int
    public let lastIssue: MacCaptureIssueCode?

    public init(
        acceptedEvents: Int = 0,
        capturedImages: Int = 0,
        recordedSteps: Int = 0,
        mergedEvents: Int = 0,
        pendingEvents: Int = 0,
        screenshotFailures: Int = 0,
        screenshotRetries: Int = 0,
        semanticSkips: Int = 0,
        sensitiveSkips: Int = 0,
        eventPersistenceFailures: Int = 0,
        lastIssue: MacCaptureIssueCode? = nil
    ) {
        self.acceptedEvents = acceptedEvents
        self.capturedImages = capturedImages
        self.recordedSteps = recordedSteps
        self.mergedEvents = mergedEvents
        self.pendingEvents = pendingEvents
        self.screenshotFailures = screenshotFailures
        self.screenshotRetries = screenshotRetries
        self.semanticSkips = semanticSkips
        self.sensitiveSkips = sensitiveSkips
        self.eventPersistenceFailures = eventPersistenceFailures
        self.lastIssue = lastIssue
    }
}

#if os(macOS)
import AppKit

public actor MacCapturePipeline {
    private static let maximumCaptureAttempts = 3

    private let recorder: NativeRecorder
    nonisolated private let reader: any NativeSemanticEventReading
    private let capture: SerializedNativeCapture
    private let vault: NativeAssetVault
    nonisolated private let submittedEvents = SubmittedCaptureEvents()
    nonisolated private let diagnostics = MacCaptureDiagnosticsStore()

    public init(
        recorder: NativeRecorder,
        reader: any NativeSemanticEventReading,
        capture: SerializedNativeCapture,
        vault: NativeAssetVault
    ) {
        self.recorder = recorder
        self.reader = reader
        self.capture = capture
        self.vault = vault
    }

    /// Reads Accessibility synchronously while AppKit's global event still
    /// identifies the correct app/control, then serializes all screenshot work.
    public nonisolated func submit(_ action: NativeCaptureAction) {
        guard submittedEvents.isAccepting else { return }
        let occurredAt = Date()
        guard let event = reader.focusedEvent(action: action, occurredAt: occurredAt) else {
            diagnostics.noteSemanticSkip()
            return
        }
        let accepted = submittedEvents.submit { [self] in
            await handle(event)
        }
        if accepted {
            diagnostics.noteAcceptedEvent()
        }
    }

    public nonisolated func startAcceptingEvents() {
        submittedEvents.startAccepting()
    }

    public nonisolated func stopAcceptingEvents() {
        submittedEvents.stopAccepting()
    }

    public nonisolated func waitForSubmittedEvents() async {
        await submittedEvents.waitUntilIdle()
    }

    public nonisolated func resetDiagnostics() {
        diagnostics.reset()
    }

    public nonisolated func diagnosticsSnapshot() -> MacCaptureDiagnostics {
        diagnostics.snapshot(pendingEvents: submittedEvents.pendingCount)
    }

    private func handle(_ event: NativeSemanticEvent) async {
        guard let session = recorder.snapshot(), session.state == .recording else { return }
        if event.isSensitiveField {
            record(event, screenshot: nil)
            diagnostics.noteSensitiveSkip()
            return
        }

        // Adjacent keystrokes are one user action. Persist each receipt, but avoid
        // creating and then deleting a full-screen image for every character.
        if shouldCoalesceBurst(event, in: session) {
            record(event, screenshot: nil)
            return
        }

        await waitForInterfaceToSettle(after: event)
        let request = NativeCaptureRequest(
            eventID: event.eventID,
            bounds: event.bounds,
            usesRecordingScope: true
        )

        do {
            let frame = try await captureWithRetry(request)
            let asset = try vault.writeRaw(frame: frame, sessionID: session.sessionID)
            let decision = record(event, screenshot: asset)
            let retained = recorder.snapshot()?.assets.contains {
                $0.assetID == asset.assetID
            } == true
            if retained {
                diagnostics.noteCapturedImage()
            } else {
                try? vault.delete(localKey: asset.localKey)
            }
            if decision == nil {
                // The semantic event failed to persist. The image has already been
                // deleted above because it was not referenced by the manifest.
                return
            }
        } catch {
            diagnostics.noteScreenshotFailure()
            // A transient ScreenCaptureKit failure must not erase the user's step.
            // Persist the platform-neutral action without an image so the UI can
            // surface a precise count and a later event can recover a merged input.
            record(event, screenshot: nil)
        }
    }

    @discardableResult
    private func record(
        _ event: NativeSemanticEvent,
        screenshot: NativeCapturedAsset?
    ) -> NativeRecordDecision? {
        do {
            let decision = try recorder.record(event, screenshot: screenshot)
            diagnostics.noteRecordDecision(decision)
            return decision
        } catch {
            diagnostics.noteEventPersistenceFailure()
            return nil
        }
    }

    private func shouldCoalesceBurst(
        _ event: NativeSemanticEvent,
        in session: AtriumCaptureSession
    ) -> Bool {
        guard let last = session.steps.last,
              last.screenshotAssetID != nil,
              last.target?.macos?.bundleID == event.bundleID,
              event.occurredAt.timeIntervalSince(last.occurredAt) >= 0
        else { return false }
        if event.action == .input, last.action == .input {
            return last.target?.accessibleName == clean(event.accessibleName)
                && event.occurredAt.timeIntervalSince(last.occurredAt) <= 2
        }
        if event.action == .scroll, last.action == .scroll {
            return event.occurredAt.timeIntervalSince(last.occurredAt) <= 0.75
        }
        return false
    }

    private func clean(_ value: String?) -> String? {
        guard let value else { return nil }
        let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
        return trimmed.isEmpty ? nil : String(trimmed.prefix(500))
    }

    private func waitForInterfaceToSettle(after event: NativeSemanticEvent) async {
        let delay: TimeInterval = switch event.action {
        case .click, .navigate, .select, .shortcut, .submit:
            0.15
        case .drag, .scroll:
            0.15
        case .input:
            0.30
        case .manual:
            0
        }
        let remaining = event.occurredAt.addingTimeInterval(delay).timeIntervalSinceNow
        guard remaining > 0 else { return }
        try? await Task.sleep(nanoseconds: UInt64(remaining * 1_000_000_000))
    }

    private func captureWithRetry(
        _ request: NativeCaptureRequest
    ) async throws -> NativeCapturedFrame {
        var lastError: Error?
        for attempt in 0..<Self.maximumCaptureAttempts {
            do {
                return try await capture.capture(request: request)
            } catch {
                lastError = error
                guard attempt + 1 < Self.maximumCaptureAttempts else { break }
                diagnostics.noteScreenshotRetry()
                let nanoseconds: UInt64 = attempt == 0 ? 150_000_000 : 350_000_000
                try? await Task.sleep(nanoseconds: nanoseconds)
            }
        }
        throw lastError ?? MacCapturePipelineError.screenshotUnavailable
    }
}

private enum MacCapturePipelineError: Error {
    case screenshotUnavailable
}

@MainActor
public final class MacEventMonitor {
    private var monitors: [Any] = []
    private let pipeline: MacCapturePipeline

    public init(pipeline: MacCapturePipeline) {
        self.pipeline = pipeline
    }

    public func start() {
        guard monitors.isEmpty else { return }
        pipeline.startAcceptingEvents()
        if let mouse = NSEvent.addGlobalMonitorForEvents(
            matching: [.leftMouseUp, .rightMouseUp],
            handler: { [pipeline] _ in pipeline.submit(.click) }
        ) {
            monitors.append(mouse)
        }
        if let keyboard = NSEvent.addGlobalMonitorForEvents(
            matching: [.keyDown],
            handler: { [pipeline] event in
                let action: NativeCaptureAction = event.modifierFlags
                    .intersection([.command, .control, .option]).isEmpty ? .input : .shortcut
                pipeline.submit(action)
            }
        ) {
            monitors.append(keyboard)
        }
        if let scroll = NSEvent.addGlobalMonitorForEvents(
            matching: [.scrollWheel],
            handler: { [pipeline] _ in pipeline.submit(.scroll) }
        ) {
            monitors.append(scroll)
        }
    }

    public func stop() {
        pipeline.stopAcceptingEvents()
        monitors.forEach(NSEvent.removeMonitor)
        monitors.removeAll()
    }

    public func waitForPendingCaptures() async {
        await pipeline.waitForSubmittedEvents()
    }

    public func resetDiagnostics() {
        pipeline.resetDiagnostics()
    }

    public func diagnosticsSnapshot() -> MacCaptureDiagnostics {
        pipeline.diagnosticsSnapshot()
    }
}

private final class SubmittedCaptureEvents: @unchecked Sendable {
    private let lock = NSLock()
    private var accepting = false
    private var pending = 0
    private var tail: Task<Void, Never>?
    private var waiters: [CheckedContinuation<Void, Never>] = []

    var isAccepting: Bool {
        lock.lock()
        defer { lock.unlock() }
        return accepting
    }

    var pendingCount: Int {
        lock.lock()
        defer { lock.unlock() }
        return pending
    }

    func startAccepting() {
        lock.lock()
        accepting = true
        lock.unlock()
    }

    func stopAccepting() {
        lock.lock()
        accepting = false
        lock.unlock()
    }

    @discardableResult
    func submit(_ operation: @escaping @Sendable () async -> Void) -> Bool {
        lock.lock()
        guard accepting else {
            lock.unlock()
            return false
        }
        pending += 1
        let previous = tail
        let task = Task { [self] in
            if let previous { await previous.value }
            await operation()
            complete()
        }
        tail = task
        lock.unlock()
        return true
    }

    func waitUntilIdle() async {
        await withCheckedContinuation { continuation in
            lock.lock()
            if pending == 0 {
                lock.unlock()
                continuation.resume()
            } else {
                waiters.append(continuation)
                lock.unlock()
            }
        }
    }

    private func complete() {
        let completedWaiters: [CheckedContinuation<Void, Never>]
        lock.lock()
        pending = max(0, pending - 1)
        if pending == 0 {
            completedWaiters = waiters
            waiters.removeAll()
        } else {
            completedWaiters = []
        }
        lock.unlock()
        completedWaiters.forEach { $0.resume() }
    }
}

private final class MacCaptureDiagnosticsStore: @unchecked Sendable {
    private let lock = NSLock()
    private var value = MacCaptureDiagnostics()

    func reset() {
        lock.lock()
        value = MacCaptureDiagnostics()
        lock.unlock()
    }

    func snapshot(pendingEvents: Int) -> MacCaptureDiagnostics {
        lock.lock()
        defer { lock.unlock() }
        return replacing(pendingEvents: pendingEvents)
    }

    func noteAcceptedEvent() {
        update { current in
            replacing(current, acceptedEvents: current.acceptedEvents + 1)
        }
    }

    func noteCapturedImage() {
        update { current in
            replacing(current, capturedImages: current.capturedImages + 1)
        }
    }

    func noteRecordDecision(_ decision: NativeRecordDecision) {
        update { current in
            switch decision {
            case .recorded:
                replacing(current, recordedSteps: current.recordedSteps + 1)
            case .merged:
                replacing(current, mergedEvents: current.mergedEvents + 1)
            case .sensitiveField:
                replacing(current, sensitiveSkips: current.sensitiveSkips + 1)
            case .duplicate, .notRecording:
                current
            }
        }
    }

    func noteScreenshotFailure() {
        update { current in
            replacing(
                current,
                screenshotFailures: current.screenshotFailures + 1,
                lastIssue: .some(.screenshotFailed)
            )
        }
    }

    func noteScreenshotRetry() {
        update { current in
            replacing(current, screenshotRetries: current.screenshotRetries + 1)
        }
    }

    func noteSemanticSkip() {
        update { current in
            replacing(
                current,
                semanticSkips: current.semanticSkips + 1,
                lastIssue: .some(.semanticContextUnavailable)
            )
        }
    }

    func noteSensitiveSkip() {
        // `record` already notes `.sensitiveField`; this method exists to keep
        // the sensitive branch explicit without recording the event twice.
    }

    func noteEventPersistenceFailure() {
        update { current in
            replacing(
                current,
                eventPersistenceFailures: current.eventPersistenceFailures + 1,
                lastIssue: .some(.eventPersistenceFailed)
            )
        }
    }

    private func update(_ transform: (MacCaptureDiagnostics) -> MacCaptureDiagnostics) {
        lock.lock()
        value = transform(value)
        lock.unlock()
    }

    private func replacing(pendingEvents: Int) -> MacCaptureDiagnostics {
        replacing(value, pendingEvents: pendingEvents)
    }

    private func replacing(
        _ current: MacCaptureDiagnostics,
        acceptedEvents: Int? = nil,
        capturedImages: Int? = nil,
        recordedSteps: Int? = nil,
        mergedEvents: Int? = nil,
        pendingEvents: Int? = nil,
        screenshotFailures: Int? = nil,
        screenshotRetries: Int? = nil,
        semanticSkips: Int? = nil,
        sensitiveSkips: Int? = nil,
        eventPersistenceFailures: Int? = nil,
        lastIssue: MacCaptureIssueCode?? = nil
    ) -> MacCaptureDiagnostics {
        MacCaptureDiagnostics(
            acceptedEvents: acceptedEvents ?? current.acceptedEvents,
            capturedImages: capturedImages ?? current.capturedImages,
            recordedSteps: recordedSteps ?? current.recordedSteps,
            mergedEvents: mergedEvents ?? current.mergedEvents,
            pendingEvents: pendingEvents ?? current.pendingEvents,
            screenshotFailures: screenshotFailures ?? current.screenshotFailures,
            screenshotRetries: screenshotRetries ?? current.screenshotRetries,
            semanticSkips: semanticSkips ?? current.semanticSkips,
            sensitiveSkips: sensitiveSkips ?? current.sensitiveSkips,
            eventPersistenceFailures:
                eventPersistenceFailures ?? current.eventPersistenceFailures,
            lastIssue: lastIssue ?? current.lastIssue
        )
    }
}
#else
public actor MacCapturePipeline {}
public final class MacEventMonitor {
    public init() {}
}
#endif
