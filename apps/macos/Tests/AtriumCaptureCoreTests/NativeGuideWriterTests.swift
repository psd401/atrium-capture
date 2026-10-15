// ABOUTME: Tests the metadata-only Capture Guide Writer request builder, suggestion validation,
// ABOUTME: and apply-to-session logic in NativeGuideWriter.
import AtriumCaptureContracts
@testable import AtriumCaptureCore
import XCTest

final class NativeGuideWriterTests: XCTestCase {
    func testRequestCarriesOnlyStepMetadata() throws {
        let session = makeSession()
        let text = try NativeGuideWriter.buildRequest(for: session)
        let json = try XCTUnwrap(JSONSerialization.jsonObject(with: Data(text.utf8)) as? [String: Any])
        let steps = try XCTUnwrap(json["steps"] as? [[String: Any]])

        XCTAssertEqual(json["schemaVersion"] as? Int, 1)
        XCTAssertEqual(json["sessionId"] as? String, session.sessionID)
        XCTAssertEqual(steps.count, session.steps.count)
        XCTAssertEqual(steps[0]["appName"] as? String, "Synthetic App")
        XCTAssertEqual(steps[0]["windowTitle"] as? String, "Synthetic window")
        XCTAssertEqual(steps[0]["accessibleName"] as? String, "Synthetic button")
        XCTAssertEqual(steps[0]["instruction"] as? String, session.steps[0].instruction.generatedText)
        XCTAssertFalse(text.contains(session.steps[0].screenshotAssetID ?? "never"))
        XCTAssertFalse(text.contains("bounds"))
        XCTAssertFalse(text.contains("bundleId"))
    }

    func testRequestDropsIPv6LocalNetworkOrigins() throws {
        var session = makeSession()
        session = session.with(
            policy: session.policy.with(sourceURLRetention: .full),
            steps: [
                session.steps[0].with(target: session.steps[0].target?.with(
                    browser: browser(origin: "https://[fd00::1]/")
                )),
                session.steps[1].with(target: session.steps[1].target?.with(
                    browser: browser(origin: "https://[2001:db8::5]/")
                )),
            ]
        )

        let text = try NativeGuideWriter.buildRequest(for: session)
        let json = try XCTUnwrap(JSONSerialization.jsonObject(with: Data(text.utf8)) as? [String: Any])
        let steps = try XCTUnwrap(json["steps"] as? [[String: Any]])

        // Unique-local literal is dropped.
        XCTAssertNil(steps[0]["origin"])
        XCTAssertFalse(text.contains("fd00"))
        // An ordinary global IPv6 origin is not local and is kept, bracketed.
        XCTAssertEqual(steps[1]["origin"] as? String, "https://[2001:db8::5]")
    }

    private func browser(origin: String) -> Browser {
        Browser(
            devicePixelRatio: 2,
            origin: origin,
            pageTitle: nil,
            path: nil,
            selectors: nil,
            viewportCSS: ViewportCSS(height: 800, width: 1_200)
        )
    }

    func testRequestRejectsOversizeSessions() {
        var session = makeSession()
        let padded = String(repeating: "x", count: 1_900)
        session = session.with(steps: (0..<80).map { index in
            session.steps[0].with(
                instruction: session.steps[0].instruction.with(generatedText: padded),
                sequence: index,
                stepID: String(format: "10000000-0000-4000-8000-%012d", index)
            )
        })
        XCTAssertThrowsError(try NativeGuideWriter.buildRequest(for: session)) { error in
            XCTAssertEqual(error as? NativeGuideWriterError, .requestTooLarge)
        }
    }

    func testValidateRejectsUnknownMissingAndMismatchedSteps() throws {
        let session = makeSession()
        let good = suggestionJSON(for: session)
        XCTAssertNoThrow(try NativeGuideWriter.validate(text: good, session: session))
        XCTAssertNoThrow(try NativeGuideWriter.validate(text: "```json\n" + good + "\n```", session: session))

        let unknown = good.replacingOccurrences(of: session.steps[1].stepID, with: "10000000-0000-4000-8000-000000000099")
        XCTAssertThrowsError(try NativeGuideWriter.validate(text: unknown, session: session))

        let other = good.replacingOccurrences(of: session.sessionID, with: "00000000-0000-4000-8000-000000000009")
        XCTAssertThrowsError(try NativeGuideWriter.validate(text: other, session: session)) { error in
            XCTAssertEqual(error as? NativeGuideWriterError, .sessionMismatch)
        }
        XCTAssertThrowsError(try NativeGuideWriter.validate(text: "Here is the guide", session: session)) { error in
            XCTAssertEqual(error as? NativeGuideWriterError, .notJSON)
        }
    }

    func testApplyKeepsUserEditsAndSetsDistrictAI() throws {
        var session = makeSession()
        let firstID = session.steps[0].stepID
        session = try NativeReviewEditor.setInstruction(in: session, stepID: firstID, text: "My own words.")
        let suggestion = try NativeGuideWriter.validate(text: suggestionJSON(for: session), session: session)

        let applied = try NativeGuideWriter.apply(suggestion, to: session, now: Date(timeIntervalSince1970: 10))

        XCTAssertEqual(applied.title, "Synthetic written guide")
        XCTAssertEqual(applied.steps[0].instruction.editedText, "My own words.")
        XCTAssertEqual(applied.steps[0].instruction.userEdited, true)
        XCTAssertEqual(applied.steps[0].instruction.source, .districtAI)
        XCTAssertEqual(applied.steps[0].instruction.title, "Step 1")
        XCTAssertEqual(applied.steps[1].instruction.source, .districtAI)
        XCTAssertEqual(applied.steps[1].instruction.userEdited, false)
    }

    private func suggestionJSON(for session: AtriumCaptureSession) -> String {
        let steps = session.steps.enumerated().map { index, step in
            "{\"stepId\":\"\(step.stepID)\",\"title\":\"Step \(index + 1)\",\"instruction\":\"Do the synthetic thing \(index + 1).\"}"
        }.joined(separator: ",")
        return "{\"schemaVersion\":1,\"sessionId\":\"\(session.sessionID)\",\"title\":\"Synthetic written guide\",\"summary\":\"Synthetic summary.\",\"steps\":[\(steps)]}"
    }

    private func makeSession() -> AtriumCaptureSession {
        let now = Date(timeIntervalSince1970: 1_000)
        let assetID = "30000000-0000-4000-8000-000000000010"
        let target = Target(
            accessibleName: "Synthetic button",
            bounds: Geometry(height: 20, width: 20, x: 0, y: 0),
            browser: nil,
            macos: Macos(
                accessibilityRole: "AXButton",
                appName: "Synthetic App",
                backingScaleFactor: 2,
                bundleID: "test.synthetic",
                windowTitle: "Synthetic window"
            ),
            role: "button"
        )
        let steps = [
            StepElement(
                action: .click,
                annotations: [],
                crop: nil,
                instruction: Instruction(
                    editedText: nil,
                    generatedText: "Select the synthetic control.",
                    source: .rules,
                    title: nil,
                    userEdited: false
                ),
                occurredAt: now,
                privacyReview: .approved,
                screenshotAssetID: assetID,
                sequence: 0,
                stepID: "20000000-0000-4000-8000-000000000010",
                target: target
            ),
            StepElement(
                action: .click,
                annotations: [],
                crop: nil,
                instruction: Instruction(
                    editedText: nil,
                    generatedText: "Select the second synthetic control.",
                    source: .rules,
                    title: nil,
                    userEdited: false
                ),
                occurredAt: now,
                privacyReview: .approved,
                screenshotAssetID: assetID,
                sequence: 1,
                stepID: "20000000-0000-4000-8000-000000000011",
                target: target
            ),
        ]
        return AtriumCaptureSession(
            assets: [AssetElement(
                annotations: [],
                assetID: assetID,
                derivedFromAssetID: "raw-source",
                localKey: "assets/publishable.png",
                mimeType: .imagePNG,
                pixelHeight: 20,
                pixelWidth: 20,
                sha256: String(repeating: "a", count: 64),
                state: .publishableLocal
            )],
            createdAt: now,
            policy: Policy(
                denyReason: nil,
                policyVersion: "test-v1",
                rawImageRetention: .deleteAfterFlatten,
                reviewStatus: .approved,
                sourceURLRetention: .none
            ),
            recorder: Recorder(
                appVersion: "1.0.0",
                browserName: nil,
                browserVersion: nil,
                osVersion: "synthetic",
                surface: .macos
            ),
            revision: 1,
            schemaVersion: .the10,
            sessionID: "10000000-0000-4000-8000-000000000010",
            state: .review,
            steps: steps,
            title: "Synthetic native guide",
            updatedAt: now
        )
    }
}
