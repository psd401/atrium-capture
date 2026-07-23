import AtriumCaptureContracts
import Foundation
import XCTest
@testable import AtriumCaptureCore

final class NativeRecorderTests: XCTestCase {
    func testPersistsBeforeAcknowledgingAndRecoversWithoutDuplicates() throws {
        let persistence = MemoryNativeRecorderPersistence()
        let recorder = try NativeRecorder(persistence: persistence)
        _ = try recorder.start(
            sessionID: "10000000-0000-4000-8000-000000000010",
            appVersion: "1.0.0",
            osVersion: "synthetic",
            now: Date(timeIntervalSince1970: 1_000)
        )
        let event = makeEvent(id: "event-1", action: .click, timestamp: 1_001)
        XCTAssertEqual(try recorder.record(event), .recorded(stepID: recorder.snapshot()!.steps[0].stepID))

        let restarted = try NativeRecorder(persistence: persistence)
        XCTAssertEqual(restarted.snapshot()?.steps.count, 1)
        XCTAssertEqual(try restarted.record(event), .duplicate)
        XCTAssertEqual(restarted.snapshot()?.steps.count, 1)
    }

    func testRejectsSecureFieldBeforeScreenshotOrStepPersistence() throws {
        let persistence = MemoryNativeRecorderPersistence()
        let recorder = try NativeRecorder(persistence: persistence)
        _ = try recorder.start(appVersion: "1.0.0", osVersion: nil)
        let secure = makeEvent(
            id: "secure-1",
            action: .input,
            timestamp: 1_001,
            role: "AXSecureTextField",
            name: nil
        )
        let asset = NativeCapturedAsset(
            assetID: "raw-never-stored",
            localKey: "assets/raw-never-stored.png",
            sha256: String(repeating: "a", count: 64),
            pixelWidth: 10,
            pixelHeight: 10
        )
        XCTAssertEqual(try recorder.record(secure, screenshot: asset), .sensitiveField)
        XCTAssertTrue(recorder.snapshot()!.steps.isEmpty)
        XCTAssertTrue(recorder.snapshot()!.assets.isEmpty)
        let restarted = try NativeRecorder(persistence: persistence)
        XCTAssertEqual(try restarted.record(secure, screenshot: asset), .duplicate)
    }

    func testInputStepsNeverContainLiteralValuesAndMergeAdjacentEvents() throws {
        let recorder = try NativeRecorder(persistence: MemoryNativeRecorderPersistence())
        _ = try recorder.start(appVersion: "1.0.0", osVersion: nil)
        let first = makeEvent(id: "input-1", action: .input, timestamp: 1_001, name: "Synthetic label")
        let second = makeEvent(id: "input-2", action: .input, timestamp: 1_002, name: "Synthetic label")
        let firstAsset = makeAsset(id: "input-asset-1")
        let secondAsset = makeAsset(id: "input-asset-2")
        _ = try recorder.record(first, screenshot: firstAsset)
        let merged = try recorder.record(second, screenshot: secondAsset)
        XCTAssertEqual(recorder.snapshot()?.steps.count, 1)
        XCTAssertEqual(recorder.snapshot()?.assets.map(\.assetID), [firstAsset.assetID])
        XCTAssertEqual(recorder.snapshot()?.steps[0].instruction.generatedText, "Enter the requested value in Synthetic label.")
        XCTAssertEqual(recorder.snapshot()?.steps[0].privacyReview, .flagged)
        if case .merged = merged {} else { XCTFail("Expected input merge") }
    }

    func testOrdersOutOfOrderEventsAndResequencesSteps() throws {
        let recorder = try NativeRecorder(persistence: MemoryNativeRecorderPersistence())
        _ = try recorder.start(appVersion: "1.0.0", osVersion: nil)
        _ = try recorder.record(makeEvent(id: "late", action: .click, timestamp: 2_000, name: "Later"))
        _ = try recorder.record(makeEvent(id: "early", action: .click, timestamp: 1_000, name: "Earlier"))
        let steps = recorder.snapshot()!.steps
        XCTAssertEqual(steps.map(\.sequence), [0, 1])
        XCTAssertEqual(steps.map { $0.target?.accessibleName }, ["Earlier", "Later"])
    }

    func testFinderSettingsAndOfficeEventsProduceOneContractModel() throws {
        let recorder = try NativeRecorder(persistence: MemoryNativeRecorderPersistence())
        _ = try recorder.start(appVersion: "1.0.0", osVersion: "synthetic")
        let applications = [
            ("Finder", "com.apple.finder"),
            ("System Settings", "com.apple.systempreferences"),
            ("Synthetic Office", "com.example.synthetic-office"),
        ]
        for (index, application) in applications.enumerated() {
            let event = NativeSemanticEvent(
                eventID: "application-event-\(index)",
                occurredAt: Date(timeIntervalSince1970: TimeInterval(1_000 + index)),
                action: .click,
                accessibilityRole: "AXButton",
                accessibleName: "Synthetic control \(index)",
                bounds: NativeRect(x: 10, y: 20, width: 100, height: 30),
                appName: application.0,
                bundleID: application.1,
                windowTitle: "Synthetic window",
                backingScaleFactor: 2
            )
            _ = try recorder.record(event)
        }
        let session = try XCTUnwrap(recorder.snapshot())
        let encoded = try AtriumContractCodec.makeEncoder().encode(session)
        let decoded = try AtriumContractCodec.makeDecoder().decode(AtriumCaptureSession.self, from: encoded)
        XCTAssertEqual(decoded.recorder.surface, .macos)
        XCTAssertEqual(decoded.steps.map { $0.target?.macos?.appName }, applications.map(\.0))
        XCTAssertFalse(String(decoding: encoded, as: UTF8.self).localizedCaseInsensitiveContains("value\""))
    }

    private func makeEvent(
        id: String,
        action: NativeCaptureAction,
        timestamp: TimeInterval,
        role: String? = "AXButton",
        name: String? = "Synthetic control"
    ) -> NativeSemanticEvent {
        NativeSemanticEvent(
            eventID: id,
            occurredAt: Date(timeIntervalSince1970: timestamp),
            action: action,
            accessibilityRole: role,
            accessibleName: name,
            bounds: NativeRect(x: 10, y: 20, width: 100, height: 30),
            appName: "Synthetic App",
            bundleID: "org.example.synthetic",
            windowTitle: "Synthetic Window",
            backingScaleFactor: 2
        )
    }

    private func makeAsset(id: String) -> NativeCapturedAsset {
        NativeCapturedAsset(
            assetID: id,
            localKey: "assets/\(id).png",
            sha256: String(repeating: "a", count: 64),
            pixelWidth: 20,
            pixelHeight: 20
        )
    }
}
