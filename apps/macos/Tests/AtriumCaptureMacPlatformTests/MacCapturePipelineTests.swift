#if os(macOS)
import AtriumCaptureCore
@testable import AtriumCaptureMacPlatform
import Foundation
import Testing

private final class SyntheticSemanticReader: NativeSemanticEventReading, @unchecked Sendable {
    private let lock = NSLock()
    private var count = 0
    private let returnsEvent: Bool

    init(returnsEvent: Bool = true) {
        self.returnsEvent = returnsEvent
    }

    func focusedEvent(
        action: NativeCaptureAction,
        occurredAt: Date
    ) -> NativeSemanticEvent? {
        guard returnsEvent else { return nil }
        lock.lock()
        count += 1
        let sequence = count
        lock.unlock()
        return NativeSemanticEvent(
            eventID: "synthetic-event-\(sequence)",
            occurredAt: occurredAt,
            action: action,
            accessibilityRole: "AXButton",
            accessibleName: action == .input
                ? "Synthetic input"
                : "Synthetic control \(sequence)",
            bounds: NativeRect(x: 20, y: 30, width: 120, height: 40),
            appName: "Synthetic Browser",
            bundleID: "org.example.synthetic-browser",
            windowTitle: "Synthetic window",
            backingScaleFactor: 2
        )
    }

    func observedEventCount() -> Int {
        lock.lock()
        defer { lock.unlock() }
        return count
    }
}

private enum SyntheticCaptureError: Error {
    case unavailable
}

private actor GateFrameSource: NativeFrameSource {
    private var released = false
    private var releaseWaiters: [CheckedContinuation<Void, Never>] = []
    private var started = false
    private var startedWaiters: [CheckedContinuation<Void, Never>] = []
    private var requests: [NativeCaptureRequest] = []

    func capture(request: NativeCaptureRequest) async throws -> NativeCapturedFrame {
        requests.append(request)
        started = true
        let waiters = startedWaiters
        startedWaiters.removeAll()
        waiters.forEach { $0.resume() }
        if !released {
            await withCheckedContinuation { continuation in
                releaseWaiters.append(continuation)
            }
        }
        return syntheticFrame()
    }

    func waitUntilStarted() async {
        if started { return }
        await withCheckedContinuation { continuation in
            startedWaiters.append(continuation)
        }
    }

    func releaseAll() {
        released = true
        let waiters = releaseWaiters
        releaseWaiters.removeAll()
        waiters.forEach { $0.resume() }
    }

    func receivedRequests() -> [NativeCaptureRequest] {
        requests
    }
}

private actor CountingFrameSource: NativeFrameSource {
    private var requests: [NativeCaptureRequest] = []

    func capture(request: NativeCaptureRequest) async throws -> NativeCapturedFrame {
        requests.append(request)
        return syntheticFrame()
    }

    func receivedRequests() -> [NativeCaptureRequest] {
        requests
    }
}

private actor FailingFrameSource: NativeFrameSource {
    private let failuresBeforeSuccess: Int
    private var attemptsByEventID: [String: Int] = [:]

    init(failuresBeforeSuccess: Int) {
        self.failuresBeforeSuccess = failuresBeforeSuccess
    }

    func capture(request: NativeCaptureRequest) async throws -> NativeCapturedFrame {
        let attempt = (attemptsByEventID[request.eventID] ?? 0) + 1
        attemptsByEventID[request.eventID] = attempt
        if attempt <= failuresBeforeSuccess {
            throw SyntheticCaptureError.unavailable
        }
        return syntheticFrame()
    }

    func totalAttempts() -> Int {
        attemptsByEventID.values.reduce(0, +)
    }
}

private func syntheticFrame() -> NativeCapturedFrame {
    NativeCapturedFrame(
        pngData: Data([0x89, 0x50, 0x4E, 0x47]),
        pixelWidth: 320,
        pixelHeight: 200,
        backingScaleFactor: 2
    )
}

@Suite("Mac capture pipeline")
struct MacCapturePipelineTests {
    @Test("Stop can drain accepted screenshot work before entering review")
    func drainsAcceptedCaptureBeforeStop() async throws {
        let root = FileManager.default.temporaryDirectory
            .appendingPathComponent("atrium-capture-pipeline-\(UUID().uuidString)", isDirectory: true)
        defer { try? FileManager.default.removeItem(at: root) }
        let recorder = try NativeRecorder(persistence: MemoryNativeRecorderPersistence())
        _ = try recorder.start(appVersion: "test", osVersion: "synthetic")
        let source = GateFrameSource()
        let pipeline = MacCapturePipeline(
            recorder: recorder,
            reader: SyntheticSemanticReader(),
            capture: SerializedNativeCapture(source: source),
            vault: NativeAssetVault(rootURL: root)
        )

        pipeline.startAcceptingEvents()
        pipeline.submit(.click)
        await source.waitUntilStarted()
        pipeline.stopAcceptingEvents()
        pipeline.submit(.click)

        let drain = Task {
            await pipeline.waitForSubmittedEvents()
        }
        #expect(recorder.snapshot()?.steps.isEmpty == true)
        await source.releaseAll()
        await drain.value

        let reviewed = try recorder.stop()
        #expect(reviewed.state.rawValue == "review")
        #expect(reviewed.steps.count == 1)
        #expect(reviewed.assets.count == 1)
        #expect(reviewed.steps[0].screenshotAssetID == reviewed.assets[0].assetID)
        let requests = await source.receivedRequests()
        #expect(requests.count == 1)
        #expect(requests[0].usesRecordingScope)
    }

    @Test("One hundred rapid clicks are serialized without loss")
    func serializesRapidClickStress() async throws {
        let root = temporaryRoot()
        defer { try? FileManager.default.removeItem(at: root) }
        let recorder = try startedRecorder()
        let reader = SyntheticSemanticReader()
        let source = CountingFrameSource()
        let pipeline = makePipeline(
            recorder: recorder,
            reader: reader,
            source: source,
            root: root
        )

        pipeline.startAcceptingEvents()
        for _ in 0..<100 {
            pipeline.submit(.click)
        }
        #expect(reader.observedEventCount() == 100)
        pipeline.stopAcceptingEvents()
        await pipeline.waitForSubmittedEvents()

        let session = try #require(recorder.snapshot())
        let diagnostics = pipeline.diagnosticsSnapshot()
        #expect(session.steps.count == 100)
        #expect(session.assets.count == 100)
        #expect(Set(session.steps.compactMap(\.screenshotAssetID)).count == 100)
        #expect(await source.receivedRequests().count == 100)
        #expect(diagnostics.acceptedEvents == 100)
        #expect(diagnostics.recordedSteps == 100)
        #expect(diagnostics.capturedImages == 100)
        #expect(diagnostics.pendingEvents == 0)
        #expect(diagnostics.screenshotFailures == 0)
    }

    @Test("A backlog keeps the original semantic snapshots and drains completely")
    func drainsLargeBacklogWithSynchronousSemanticSnapshots() async throws {
        let root = temporaryRoot()
        defer { try? FileManager.default.removeItem(at: root) }
        let recorder = try startedRecorder()
        let reader = SyntheticSemanticReader()
        let source = GateFrameSource()
        let pipeline = makePipeline(
            recorder: recorder,
            reader: reader,
            source: source,
            root: root
        )

        pipeline.startAcceptingEvents()
        for _ in 0..<50 {
            pipeline.submit(.click)
        }
        #expect(reader.observedEventCount() == 50)
        await source.waitUntilStarted()
        pipeline.stopAcceptingEvents()
        let drain = Task { await pipeline.waitForSubmittedEvents() }
        #expect(pipeline.diagnosticsSnapshot().pendingEvents == 50)
        await source.releaseAll()
        await drain.value

        let session = try #require(recorder.snapshot())
        #expect(session.steps.count == 50)
        #expect(session.assets.count == 50)
        #expect(
            session.steps.compactMap { $0.target?.accessibleName }
                == (1...50).map { "Synthetic control \($0)" }
        )
    }

    @Test("Transient capture failures retry and eventually retain every image")
    func retriesTransientFailures() async throws {
        let root = temporaryRoot()
        defer { try? FileManager.default.removeItem(at: root) }
        let recorder = try startedRecorder()
        let source = FailingFrameSource(failuresBeforeSuccess: 2)
        let pipeline = makePipeline(
            recorder: recorder,
            reader: SyntheticSemanticReader(),
            source: source,
            root: root
        )

        pipeline.startAcceptingEvents()
        for _ in 0..<8 {
            pipeline.submit(.click)
        }
        pipeline.stopAcceptingEvents()
        await pipeline.waitForSubmittedEvents()

        let diagnostics = pipeline.diagnosticsSnapshot()
        #expect(recorder.snapshot()?.steps.count == 8)
        #expect(recorder.snapshot()?.assets.count == 8)
        #expect(await source.totalAttempts() == 24)
        #expect(diagnostics.screenshotRetries == 16)
        #expect(diagnostics.screenshotFailures == 0)
        #expect(diagnostics.capturedImages == 8)
    }

    @Test("Permanent capture failures preserve steps and report fixed diagnostics")
    func preservesStepsWhenScreenshotsAlwaysFail() async throws {
        let root = temporaryRoot()
        defer { try? FileManager.default.removeItem(at: root) }
        let recorder = try startedRecorder()
        let source = FailingFrameSource(failuresBeforeSuccess: .max)
        let pipeline = makePipeline(
            recorder: recorder,
            reader: SyntheticSemanticReader(),
            source: source,
            root: root
        )

        pipeline.startAcceptingEvents()
        for _ in 0..<4 {
            pipeline.submit(.click)
        }
        pipeline.stopAcceptingEvents()
        await pipeline.waitForSubmittedEvents()

        let session = try #require(recorder.snapshot())
        let diagnostics = pipeline.diagnosticsSnapshot()
        #expect(session.steps.count == 4)
        #expect(session.assets.isEmpty)
        #expect(session.steps.allSatisfy { $0.screenshotAssetID == nil })
        #expect(await source.totalAttempts() == 12)
        #expect(diagnostics.recordedSteps == 4)
        #expect(diagnostics.screenshotRetries == 8)
        #expect(diagnostics.screenshotFailures == 4)
        #expect(diagnostics.lastIssue == .screenshotFailed)
    }

    @Test("A typing burst creates one image and one privacy-flagged step")
    func coalescesTypingBeforeScreenshotCapture() async throws {
        let root = temporaryRoot()
        defer { try? FileManager.default.removeItem(at: root) }
        let recorder = try startedRecorder()
        let source = CountingFrameSource()
        let pipeline = makePipeline(
            recorder: recorder,
            reader: SyntheticSemanticReader(),
            source: source,
            root: root
        )

        pipeline.startAcceptingEvents()
        for _ in 0..<20 {
            pipeline.submit(.input)
        }
        pipeline.stopAcceptingEvents()
        await pipeline.waitForSubmittedEvents()

        let session = try #require(recorder.snapshot())
        let diagnostics = pipeline.diagnosticsSnapshot()
        #expect(session.steps.count == 1)
        #expect(session.assets.count == 1)
        #expect(session.steps[0].privacyReview.rawValue == "flagged")
        #expect(session.steps[0].instruction.generatedText == "Enter the requested value in Synthetic input.")
        #expect(await source.receivedRequests().count == 1)
        #expect(diagnostics.acceptedEvents == 20)
        #expect(diagnostics.recordedSteps == 1)
        #expect(diagnostics.mergedEvents == 19)
        #expect(diagnostics.capturedImages == 1)
    }

    @Test("Sixty scroll-wheel callbacks collapse into one captured action")
    func coalescesScrollWheelStorm() async throws {
        let root = temporaryRoot()
        defer { try? FileManager.default.removeItem(at: root) }
        let recorder = try startedRecorder()
        let source = CountingFrameSource()
        let pipeline = makePipeline(
            recorder: recorder,
            reader: SyntheticSemanticReader(),
            source: source,
            root: root
        )

        pipeline.startAcceptingEvents()
        for _ in 0..<60 {
            pipeline.submit(.scroll)
        }
        pipeline.stopAcceptingEvents()
        await pipeline.waitForSubmittedEvents()

        let diagnostics = pipeline.diagnosticsSnapshot()
        #expect(recorder.snapshot()?.steps.count == 1)
        #expect(recorder.snapshot()?.assets.count == 1)
        #expect(await source.receivedRequests().count == 1)
        #expect(diagnostics.acceptedEvents == 60)
        #expect(diagnostics.recordedSteps == 1)
        #expect(diagnostics.mergedEvents == 59)
        #expect(diagnostics.capturedImages == 1)
    }

    @Test("Pausing event acceptance rejects late input and resumes cleanly")
    func rejectsEventsBetweenAcceptanceWindows() async throws {
        let root = temporaryRoot()
        defer { try? FileManager.default.removeItem(at: root) }
        let recorder = try startedRecorder()
        let reader = SyntheticSemanticReader()
        let source = CountingFrameSource()
        let pipeline = makePipeline(
            recorder: recorder,
            reader: reader,
            source: source,
            root: root
        )

        pipeline.startAcceptingEvents()
        pipeline.submit(.click)
        pipeline.stopAcceptingEvents()
        pipeline.submit(.click)
        await pipeline.waitForSubmittedEvents()
        pipeline.startAcceptingEvents()
        pipeline.submit(.shortcut)
        pipeline.stopAcceptingEvents()
        await pipeline.waitForSubmittedEvents()

        #expect(reader.observedEventCount() == 2)
        #expect(recorder.snapshot()?.steps.count == 2)
        #expect(recorder.snapshot()?.assets.count == 2)
        #expect(pipeline.diagnosticsSnapshot().acceptedEvents == 2)
    }

    @Test("Unavailable semantic context is counted without queuing screenshots")
    func countsSemanticSkipsWithoutCapturing() async throws {
        let root = temporaryRoot()
        defer { try? FileManager.default.removeItem(at: root) }
        let recorder = try startedRecorder()
        let source = CountingFrameSource()
        let pipeline = makePipeline(
            recorder: recorder,
            reader: SyntheticSemanticReader(returnsEvent: false),
            source: source,
            root: root
        )

        pipeline.startAcceptingEvents()
        for _ in 0..<10 {
            pipeline.submit(.click)
        }
        pipeline.stopAcceptingEvents()
        await pipeline.waitForSubmittedEvents()

        let diagnostics = pipeline.diagnosticsSnapshot()
        #expect(recorder.snapshot()?.steps.isEmpty == true)
        #expect(await source.receivedRequests().isEmpty)
        #expect(diagnostics.acceptedEvents == 0)
        #expect(diagnostics.semanticSkips == 10)
        #expect(diagnostics.pendingEvents == 0)
        #expect(diagnostics.lastIssue == .semanticContextUnavailable)
    }

    private func startedRecorder() throws -> NativeRecorder {
        let recorder = try NativeRecorder(persistence: MemoryNativeRecorderPersistence())
        _ = try recorder.start(appVersion: "test", osVersion: "synthetic")
        return recorder
    }

    private func temporaryRoot() -> URL {
        FileManager.default.temporaryDirectory
            .appendingPathComponent(
                "atrium-capture-pipeline-\(UUID().uuidString)",
                isDirectory: true
            )
    }

    private func makePipeline(
        recorder: NativeRecorder,
        reader: any NativeSemanticEventReading,
        source: any NativeFrameSource,
        root: URL
    ) -> MacCapturePipeline {
        MacCapturePipeline(
            recorder: recorder,
            reader: reader,
            capture: SerializedNativeCapture(source: source),
            vault: NativeAssetVault(rootURL: root)
        )
    }
}
#endif
