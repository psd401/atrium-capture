import AtriumCaptureContracts
import Foundation
import XCTest
@testable import AtriumCaptureCore

final class NativePrivacyAndPublishingTests: XCTestCase {
    func testBridgeAcceptsSharedMetadataFixture() throws {
        let fixture = try fixtureData(named: "native-bridge-v1.json")
        XCTAssertEqual(try NativeBridgeValidator.decode(fixture).type, .domStep)
    }

    func testBridgeRejectsTokensAndScreenshotBytesAtAnyDepth() throws {
        for payload in [
            ["access_token": "synthetic-secret"],
            ["nested": ["imageData": "synthetic-bytes"]],
            ["preview": "data:image/png;base64,AAAA"],
            ["authorization": "Bearer synthetic"],
            ["nested": ["typedValue": "synthetic-literal"]],
        ] as [[String: Any]] {
            let data = try bridgeData(payload: payload)
            XCTAssertThrowsError(try NativeBridgeValidator.decode(data)) { error in
                XCTAssertEqual(error as? NativeBridgeValidationError, .prohibitedPayload)
            }
        }
    }

    func testBridgeRejectsUnknownEnvelopeFields() throws {
        let data = try fixtureData(named: "native-bridge-v1.json")
        var object = try XCTUnwrap(JSONSerialization.jsonObject(with: data) as? [String: Any])
        object["unexpected"] = "synthetic"

        XCTAssertThrowsError(
            try NativeBridgeValidator.decode(JSONSerialization.data(withJSONObject: object))
        ) { error in
            XCTAssertEqual(error as? NativeBridgeValidationError, .invalidJSON)
        }
    }

    func testReviewRejectsRawAssetsAndRequiresEveryStepApproval() throws {
        let raw = makeSession(state: .review, review: .inReview, assetState: .rawLocal, stepReview: .flagged)
        XCTAssertThrowsError(try NativeReviewEditor.approveSession(raw))

        let publishable = makeSession(
            state: .review,
            review: .inReview,
            assetState: .publishableLocal,
            stepReview: .approved
        )
        let approved = try NativeReviewEditor.approveSession(publishable)
        XCTAssertEqual(approved.state, .publishable)
        XCTAssertEqual(approved.policy.reviewStatus, .approved)
    }

    func testSensitiveStepRequiresOpaqueRedactionBeforeFlatteningOrApproval() throws {
        var session = makeSession(
            state: .review,
            review: .inReview,
            assetState: .rawLocal,
            stepReview: .flagged,
            action: .input
        )
        let stepID = try XCTUnwrap(session.steps.first?.stepID)
        XCTAssertThrowsError(try NativeReviewEditor.approveStep(in: session, stepID: stepID)) { error in
            XCTAssertEqual(error as? NativeReviewError, .sensitiveRegionRequiresRedaction)
        }
        let derivative = NativeCapturedAsset(
            assetID: "30000000-0000-4000-8000-000000000011",
            localKey: "assets/redacted.png",
            sha256: String(repeating: "b", count: 64),
            pixelWidth: 20,
            pixelHeight: 20
        )
        XCTAssertThrowsError(try NativeReviewEditor.markFlattened(
            in: session,
            rawAssetID: "30000000-0000-4000-8000-000000000010",
            publishable: derivative,
            annotations: []
        )) { error in
            XCTAssertEqual(error as? NativeReviewError, .sensitiveRegionRequiresRedaction)
        }

        let mosaic = AnnotationElement(
            color: "#000000",
            geometry: Geometry(height: 10, width: 10, x: 0, y: 0),
            id: "50000000-0000-4000-8000-000000000010",
            kind: .mosaic,
            text: nil
        )
        session = try NativeReviewEditor.setAnnotations(in: session, stepID: stepID, annotations: [mosaic])
        XCTAssertThrowsError(try NativeReviewEditor.validatePrivacyAnnotations(in: session))

        let redaction = AnnotationElement(
            color: "#000000",
            geometry: Geometry(height: 10, width: 10, x: 0, y: 0),
            id: "50000000-0000-4000-8000-000000000011",
            kind: .redaction,
            text: nil
        )
        session = try NativeReviewEditor.setAnnotations(in: session, stepID: stepID, annotations: [redaction])
        XCTAssertNoThrow(try NativeReviewEditor.validatePrivacyAnnotations(in: session))
        XCTAssertNoThrow(try NativeReviewEditor.approveStep(in: session, stepID: stepID))
    }

    func testNativeEditorSupportsInsertMoveMergeAndDelete() throws {
        var session = makeSession(
            state: .review,
            review: .inReview,
            assetState: .rawLocal,
            stepReview: .notReviewed
        )
        session = try NativeReviewEditor.insertManualStep(
            in: session,
            afterStepID: session.steps[0].stepID,
            text: "Complete the synthetic follow-up.",
            stepID: "20000000-0000-4000-8000-000000000011"
        )
        XCTAssertEqual(session.steps.map(\.sequence), [0, 1])
        session = try NativeReviewEditor.moveStep(
            in: session,
            stepID: "20000000-0000-4000-8000-000000000011",
            toIndex: 0
        )
        XCTAssertEqual(session.steps[0].action, .manual)
        session = try NativeReviewEditor.mergeStepWithNext(
            in: session,
            stepID: session.steps[0].stepID
        )
        XCTAssertEqual(session.steps.count, 1)
        XCTAssertNotNil(session.steps[0].screenshotAssetID)
        session = try NativeReviewEditor.deleteStep(in: session, stepID: session.steps[0].stepID)
        XCTAssertTrue(session.steps.isEmpty)
        XCTAssertEqual(session.assets[0].state, .deleted)
    }

    func testPublisherRecoversEveryLostResponseWithoutRemoteDuplicates() throws {
        for failure in [
            MockNativeFailurePoint.object,
            .asset,
            .version,
            .internalPublish,
        ] {
            let repository = MemoryNativePublishRepository(assets: ["assets/publishable.png": Data([1, 2, 3])])
            let gateway = MockNativeAtriumGateway(failAfterCommitAt: failure)
            let publisher = DurableNativePublisher(repository: repository, gateway: gateway)
            let job = try publisher.enqueue(
                session: makeSession(
                    state: .publishable,
                    review: .approved,
                    assetState: .publishableLocal,
                    stepReview: .approved
                ),
                jobID: "job-\(failure.rawValue)"
            )

            XCTAssertThrowsError(try publisher.resume(jobID: job.jobID, publishInternal: true))
            let recovered = try publisher.resume(jobID: job.jobID, publishInternal: true)
            XCTAssertEqual(recovered.phase, .complete)
            let counts = gateway.remoteCounts
            XCTAssertEqual(counts.objects, 1)
            XCTAssertEqual(counts.assets, 1)
            XCTAssertEqual(counts.versions, 1)
            XCTAssertEqual(counts.publishes, 1)
        }
    }

    func testPublisherCannotEnqueueRawOrUnreviewedSession() throws {
        let repository = MemoryNativePublishRepository()
        let publisher = DurableNativePublisher(repository: repository, gateway: MockNativeAtriumGateway())
        XCTAssertThrowsError(try publisher.enqueue(
            session: makeSession(state: .review, review: .inReview, assetState: .rawLocal, stepReview: .flagged)
        ))
        XCTAssertThrowsError(try publisher.enqueue(
            session: makeSession(
                state: .publishable,
                review: .approved,
                assetState: .rawLocal,
                stepReview: .approved
            )
        )) { error in
            XCTAssertEqual(error as? NativePublishError, .rawAssetRejected)
        }
        XCTAssertThrowsError(try publisher.enqueue(
            session: makeSession(
                state: .publishable,
                review: .approved,
                assetState: .publishableLocal,
                stepReview: .approved,
                action: .input
            )
        )) { error in
            XCTAssertEqual(error as? NativePublishError, .reviewRequired)
        }
    }

    private func makeSession(
        state: AtriumCaptureSessionState,
        review: ReviewStatus,
        assetState: AssetState,
        stepReview: PrivacyReview,
        action: Action = .click
    ) -> AtriumCaptureSession {
        let assetID = "30000000-0000-4000-8000-000000000010"
        let now = Date(timeIntervalSince1970: 1_000)
        return AtriumCaptureSession(
            assets: [AssetElement(
                annotations: [],
                assetID: assetID,
                derivedFromAssetID: assetState == .publishableLocal ? "raw-source" : nil,
                localKey: "assets/publishable.png",
                mimeType: .imagePNG,
                pixelHeight: 20,
                pixelWidth: 20,
                sha256: String(repeating: "a", count: 64),
                state: assetState
            )],
            createdAt: now,
            policy: Policy(
                denyReason: nil,
                policyVersion: "test-v1",
                rawImageRetention: .deleteAfterFlatten,
                reviewStatus: review,
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
            state: state,
            steps: [StepElement(
                action: action,
                annotations: [],
                crop: nil,
                instruction: Instruction(
                    editedText: nil,
                    generatedText: "Select the synthetic control.",
                    source: .rules,
                    userEdited: false
                ),
                occurredAt: now,
                privacyReview: stepReview,
                screenshotAssetID: assetID,
                sequence: 0,
                stepID: "20000000-0000-4000-8000-000000000010",
                target: nil
            )],
            title: "Synthetic native guide",
            updatedAt: now
        )
    }

    private func bridgeData(payload: [String: Any]) throws -> Data {
        try JSONSerialization.data(withJSONObject: [
            "protocolVersion": 1,
            "messageId": "40000000-0000-4000-8000-000000000010",
            "type": "dom_step",
            "sentAt": "2026-01-15T15:00:01.000Z",
            "payload": payload,
        ])
    }

    private func fixtureData(named name: String) throws -> Data {
        var repositoryRoot = URL(fileURLWithPath: #filePath)
        for _ in 0..<5 { repositoryRoot.deleteLastPathComponent() }
        return try Data(
            contentsOf: repositoryRoot
                .appendingPathComponent("packages/test-fixtures/fixtures")
                .appendingPathComponent(name)
        )
    }
}
