import AtriumCaptureContracts
import Foundation

public protocol NativeRecorderPersistence: AnyObject {
    func load() throws -> Data?
    func save(_ data: Data) throws
}

public final class FileNativeRecorderPersistence: NativeRecorderPersistence, @unchecked Sendable {
    private let url: URL
    private let lock = NSLock()

    public init(url: URL) {
        self.url = url
    }

    public func load() throws -> Data? {
        lock.lock()
        defer { lock.unlock() }
        guard FileManager.default.fileExists(atPath: url.path) else { return nil }
        return try Data(contentsOf: url)
    }

    public func save(_ data: Data) throws {
        lock.lock()
        defer { lock.unlock() }
        try FileManager.default.createDirectory(
            at: url.deletingLastPathComponent(),
            withIntermediateDirectories: true
        )
        try data.write(to: url, options: .atomic)
    }
}

public final class MemoryNativeRecorderPersistence: NativeRecorderPersistence, @unchecked Sendable {
    private let lock = NSLock()
    private var stored: Data?

    public init(initialData: Data? = nil) {
        stored = initialData
    }

    public func load() -> Data? {
        lock.lock()
        defer { lock.unlock() }
        return stored
    }

    public func save(_ data: Data) {
        lock.lock()
        stored = data
        lock.unlock()
    }
}

public enum NativeRecordDecision: Equatable, Sendable {
    case recorded(stepID: String)
    case merged(stepID: String)
    case duplicate
    case sensitiveField
    case notRecording
}

public enum NativeRecorderError: Error, Equatable {
    case noSession
    case invalidState
    case invalidEvent
}

private struct NativeRecorderEnvelope: Codable {
    let session: AtriumCaptureSession
    let eventReceipts: [String]
}

/// Synchronous and locked by design: persistence succeeds before an event is acknowledged.
public final class NativeRecorder: @unchecked Sendable {
    private let persistence: any NativeRecorderPersistence
    private let lock = NSLock()
    private var envelope: NativeRecorderEnvelope?

    public init(persistence: any NativeRecorderPersistence) throws {
        self.persistence = persistence
        if let data = try persistence.load() {
            envelope = try AtriumContractCodec.makeDecoder().decode(NativeRecorderEnvelope.self, from: data)
        }
    }

    @discardableResult
    public func start(
        sessionID: String = UUID().uuidString.lowercased(),
        title: String = "Untitled Mac capture",
        appVersion: String,
        osVersion: String?,
        now: Date = Date()
    ) throws -> AtriumCaptureSession {
        lock.lock()
        defer { lock.unlock() }
        let session = AtriumCaptureSession(
            assets: [],
            createdAt: now,
            policy: Policy(
                denyReason: nil,
                policyVersion: "native-default-v1",
                rawImageRetention: .deleteAfterFlatten,
                reviewStatus: .notReviewed,
                sourceURLRetention: .none
            ),
            recorder: Recorder(
                appVersion: appVersion,
                browserName: nil,
                browserVersion: nil,
                osVersion: osVersion,
                surface: .macos
            ),
            revision: 0,
            schemaVersion: .the10,
            sessionID: sessionID,
            state: .recording,
            steps: [],
            title: Self.clean(title, fallback: "Untitled Mac capture"),
            updatedAt: now
        )
        try persist(NativeRecorderEnvelope(session: session, eventReceipts: []))
        return session
    }

    public func snapshot() -> AtriumCaptureSession? {
        lock.lock()
        defer { lock.unlock() }
        return envelope?.session
    }

    @discardableResult
    public func pause(now: Date = Date()) throws -> AtriumCaptureSession {
        try transition(to: .paused, allowed: [.recording], now: now)
    }

    @discardableResult
    public func resume(now: Date = Date()) throws -> AtriumCaptureSession {
        try transition(to: .recording, allowed: [.paused], now: now)
    }

    @discardableResult
    public func stop(now: Date = Date()) throws -> AtriumCaptureSession {
        try transition(to: .review, allowed: [.recording, .paused], now: now)
    }

    public func record(
        _ event: NativeSemanticEvent,
        screenshot: NativeCapturedAsset? = nil
    ) throws -> NativeRecordDecision {
        lock.lock()
        defer { lock.unlock() }

        guard let current = envelope else { throw NativeRecorderError.noSession }
        guard current.session.state == .recording else { return .notRecording }
        return try persistEvent(
            event,
            screenshot: screenshot,
            current: current,
            stateAfterRecording: .recording,
            reviewStatusAfterRecording: current.session.policy.reviewStatus
        )
    }

    /// Adds an explicitly requested capture to the guide currently under review.
    /// The session and event receipt are persisted before the capture is acknowledged.
    public func appendCaptureForReview(
        _ event: NativeSemanticEvent,
        screenshot: NativeCapturedAsset? = nil
    ) throws -> NativeRecordDecision {
        lock.lock()
        defer { lock.unlock() }

        guard let current = envelope else { throw NativeRecorderError.noSession }
        guard current.session.state == .review || current.session.state == .publishable else {
            throw NativeRecorderError.invalidState
        }
        return try persistEvent(
            event,
            screenshot: screenshot,
            current: current,
            stateAfterRecording: .review,
            reviewStatusAfterRecording: .inReview
        )
    }

    private func persistEvent(
        _ event: NativeSemanticEvent,
        screenshot: NativeCapturedAsset?,
        current: NativeRecorderEnvelope,
        stateAfterRecording: AtriumCaptureSessionState,
        reviewStatusAfterRecording: ReviewStatus
    ) throws -> NativeRecordDecision {
        var current = current
        guard !event.eventID.isEmpty, !event.appName.isEmpty, !event.bundleID.isEmpty else {
            throw NativeRecorderError.invalidEvent
        }
        guard !current.eventReceipts.contains(event.eventID) else { return .duplicate }
        if event.isSensitiveField {
            var receipts = current.eventReceipts
            receipts.append(event.eventID)
            if receipts.count > 2_000 { receipts.removeFirst(receipts.count - 2_000) }
            try persist(NativeRecorderEnvelope(session: current.session, eventReceipts: receipts))
            return .sensitiveField
        }

        let stepID = UUID().uuidString.lowercased()
        let cleanName = Self.cleanOptional(event.accessibleName)
        let cleanRole = Self.cleanOptional(event.accessibilityRole)
        let target = Target(
            accessibleName: cleanName,
            bounds: event.bounds?.isValid == true ? event.bounds?.contractGeometry : nil,
            browser: nil,
            macos: Macos(
                accessibilityRole: cleanRole,
                appName: Self.clean(event.appName, fallback: "Application"),
                backingScaleFactor: max(1, event.backingScaleFactor),
                bundleID: event.bundleID,
                windowTitle: Self.cleanOptional(event.windowTitle)
            ),
            role: cleanRole
        )
        let step = StepElement(
            action: event.action.contractAction,
            annotations: [],
            crop: nil,
            instruction: Instruction(
                editedText: nil,
                generatedText: Self.instruction(for: event.action, name: cleanName),
                source: .rules,
                userEdited: false
            ),
            occurredAt: event.occurredAt,
            privacyReview: event.action == .input ? .flagged : .notReviewed,
            screenshotAssetID: screenshot?.assetID,
            sequence: current.session.steps.count,
            stepID: stepID,
            target: target
        )

        var steps = current.session.steps
        let shouldMergeInput = event.action == .input
            && steps.last?.action == .input
            && steps.last?.target?.macos?.bundleID == event.bundleID
            && steps.last?.target?.accessibleName == cleanName
            && event.occurredAt.timeIntervalSince(steps.last?.occurredAt ?? .distantPast) <= 2

        let result: NativeRecordDecision
        if shouldMergeInput, let last = steps.last {
            steps[steps.count - 1] = last.with(occurredAt: event.occurredAt)
            result = .merged(stepID: last.stepID)
        } else {
            steps.append(step)
            steps.sort { lhs, rhs in
                if lhs.occurredAt == rhs.occurredAt { return lhs.stepID < rhs.stepID }
                return lhs.occurredAt < rhs.occurredAt
            }
            steps = steps.enumerated().map { index, item in item.with(sequence: index) }
            result = .recorded(stepID: stepID)
        }

        var assets = current.session.assets
        if !shouldMergeInput,
           let screenshot,
           !assets.contains(where: { $0.assetID == screenshot.assetID }) {
            assets.append(AssetElement(
                annotations: [],
                assetID: screenshot.assetID,
                derivedFromAssetID: nil,
                localKey: screenshot.localKey,
                mimeType: .imagePNG,
                pixelHeight: screenshot.pixelHeight,
                pixelWidth: screenshot.pixelWidth,
                sha256: screenshot.sha256,
                state: .rawLocal
            ))
        }

        var receipts = current.eventReceipts
        receipts.append(event.eventID)
        if receipts.count > 2_000 { receipts.removeFirst(receipts.count - 2_000) }
        current = NativeRecorderEnvelope(
            session: current.session.with(
                assets: assets,
                policy: current.session.policy.with(reviewStatus: reviewStatusAfterRecording),
                revision: current.session.revision + 1,
                state: stateAfterRecording,
                steps: steps,
                updatedAt: max(current.session.updatedAt, event.occurredAt)
            ),
            eventReceipts: receipts
        )
        try persist(current)
        return result
    }

    public func replaceReviewedSession(_ session: AtriumCaptureSession) throws {
        lock.lock()
        defer { lock.unlock() }
        guard let current = envelope, current.session.sessionID == session.sessionID else {
            throw NativeRecorderError.noSession
        }
        try persist(NativeRecorderEnvelope(session: session, eventReceipts: current.eventReceipts))
    }

    private func transition(
        to state: AtriumCaptureSessionState,
        allowed: [AtriumCaptureSessionState],
        now: Date
    ) throws -> AtriumCaptureSession {
        lock.lock()
        defer { lock.unlock() }
        guard let current = envelope else { throw NativeRecorderError.noSession }
        guard allowed.contains(current.session.state) else { throw NativeRecorderError.invalidState }
        let session = current.session.with(
            revision: current.session.revision + 1,
            state: state,
            updatedAt: now
        )
        try persist(NativeRecorderEnvelope(session: session, eventReceipts: current.eventReceipts))
        return session
    }

    private func persist(_ next: NativeRecorderEnvelope) throws {
        let data = try AtriumContractCodec.makeEncoder().encode(next)
        try persistence.save(data)
        envelope = next
    }

    private static func instruction(for action: NativeCaptureAction, name: String?) -> String {
        let subject = name ?? "the requested control"
        switch action {
        case .click: return "Select \(subject)."
        case .drag: return "Drag \(subject)."
        case .input: return "Enter the requested value in \(subject)."
        case .manual: return "Complete the requested action in \(subject)."
        case .navigate: return "Continue to \(subject)."
        case .scroll: return "Scroll in \(subject)."
        case .select: return "Choose \(subject)."
        case .shortcut: return "Use the requested shortcut in \(subject)."
        case .submit: return "Submit \(subject)."
        }
    }

    private static func cleanOptional(_ value: String?) -> String? {
        guard let value else { return nil }
        let cleaned = clean(value, fallback: "")
        return cleaned.isEmpty ? nil : cleaned
    }

    private static func clean(_ value: String, fallback: String) -> String {
        let withoutControls = value.unicodeScalars
            .filter { !CharacterSet.controlCharacters.contains($0) }
            .map(String.init)
            .joined()
            .trimmingCharacters(in: .whitespacesAndNewlines)
        if withoutControls.isEmpty { return fallback }
        return String(withoutControls.prefix(160))
    }
}
