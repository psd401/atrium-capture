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
            arrowDirection: nil,
            color: "#000000",
            geometry: Geometry(height: 10, width: 10, x: 0, y: 0),
            id: "50000000-0000-4000-8000-000000000010",
            kind: .mosaic,
            text: nil
        )
        session = try NativeReviewEditor.setAnnotations(in: session, stepID: stepID, annotations: [mosaic])
        XCTAssertThrowsError(try NativeReviewEditor.validatePrivacyAnnotations(in: session))

        let redaction = AnnotationElement(
            arrowDirection: nil,
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
        session = try NativeReviewEditor.setTitle(
            in: session,
            title: "  Synthetic renamed guide  "
        )
        XCTAssertEqual(session.title, "Synthetic renamed guide")
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

    func testManualStepReopensPreparedGuideButTitleRenamePreservesItsState() throws {
        var session = makeSession(
            state: .publishable,
            review: .approved,
            assetState: .publishableLocal,
            stepReview: .approved
        )
        session = try NativeReviewEditor.setTitle(in: session, title: "Prepared synthetic guide")
        XCTAssertEqual(session.state, .publishable)
        XCTAssertEqual(session.policy.reviewStatus, .approved)

        session = try NativeReviewEditor.insertManualStep(
            in: session,
            afterStepID: session.steps.last?.stepID,
            text: "Complete the synthetic manual step."
        )
        XCTAssertEqual(session.state, .review)
        XCTAssertEqual(session.policy.reviewStatus, .inReview)
        XCTAssertEqual(session.steps.last?.action, .manual)

        XCTAssertThrowsError(
            try NativeReviewEditor.setTitle(in: session, title: String(repeating: "x", count: 501))
        ) { error in
            XCTAssertEqual(error as? NativeReviewError, .invalidTitle)
        }
    }

    func testPublisherRecoversEveryLostResponseWithoutRemoteDuplicates() async throws {
        for failure in [
            MockNativeFailurePoint.object,
            .asset,
            .version,
            .internalPublish,
        ] {
            let repository = MemoryNativePublishRepository(assets: ["assets/publishable.png": Data([1, 2, 3])])
            let requestID = failure == .object ? "req_synthetic_object_create" : nil
            let gateway = MockNativeAtriumGateway(
                failAfterCommitAt: failure,
                failureRequestID: requestID
            )
            let publisher = DurableNativePublisher(repository: repository, gateway: gateway)
            let job = try await publisher.enqueue(
                session: makeSession(
                    state: .publishable,
                    review: .approved,
                    assetState: .publishableLocal,
                    stepReview: .approved
                ),
                jobID: "job-\(failure.rawValue)"
            )

            do {
                _ = try await publisher.resume(jobID: job.jobID, publishInternal: true)
                XCTFail("Expected the synthetic committed-response failure.")
            } catch {}
            if failure == .object {
                let interrupted = try XCTUnwrap(repository.loadJob(jobID: job.jobID))
                XCTAssertEqual(interrupted.lastError?.requestID, requestID)
            }
            let recovered = try await publisher.resume(jobID: job.jobID, publishInternal: true)
            XCTAssertEqual(recovered.phase, .complete)
            let counts = gateway.remoteCounts
            XCTAssertEqual(counts.objects, 1)
            XCTAssertEqual(counts.assets, 1)
            XCTAssertEqual(counts.versions, 1)
            XCTAssertEqual(counts.publishes, 1)
        }
    }

    func testExplicitRetryRepairsNeedsAttentionWithoutRemoteDuplicates() async throws {
        for failure in [
            MockNativeFailurePoint.object,
            .asset,
            .version,
            .internalPublish,
        ] {
            let repository = MemoryNativePublishRepository(assets: [
                "assets/publishable.png": Data([1, 2, 3]),
            ])
            let gateway = MockNativeAtriumGateway(
                failAfterCommitAt: failure,
                failureRetryable: false
            )
            let publisher = DurableNativePublisher(repository: repository, gateway: gateway)
            let job = try await publisher.enqueue(
                session: makeSession(
                    state: .publishable,
                    review: .approved,
                    assetState: .publishableLocal,
                    stepReview: .approved
                ),
                jobID: "needs-attention-\(failure.rawValue)"
            )

            do {
                _ = try await publisher.resume(jobID: job.jobID, publishInternal: true)
                XCTFail("Expected the synthetic non-retryable response failure.")
            } catch {}
            let interrupted = try XCTUnwrap(repository.loadJob(jobID: job.jobID))
            XCTAssertEqual(interrupted.phase, .needsAttention)
            XCTAssertFalse(interrupted.lastError?.retryable ?? true)

            let recovered = try await publisher.retry(
                jobID: job.jobID,
                publishInternal: true
            )

            XCTAssertEqual(recovered.phase, .complete)
            XCTAssertNil(recovered.lastError)
            let counts = gateway.remoteCounts
            XCTAssertEqual(counts.objects, 1)
            XCTAssertEqual(counts.assets, 1)
            XCTAssertEqual(counts.versions, 1)
            XCTAssertEqual(counts.publishes, 1)
        }
    }

    func testPublisherFreezesAmbiguousCreateTitleThenSynchronizesLatestRename() async throws {
        let repository = MemoryNativePublishRepository(assets: [
            "assets/publishable.png": Data([1, 2, 3]),
        ])
        let gateway = MockNativeAtriumGateway(failAfterCommitAt: .object)
        let publisher = DurableNativePublisher(repository: repository, gateway: gateway)
        let original = makeSession(
            state: .publishable,
            review: .approved,
            assetState: .publishableLocal,
            stepReview: .approved
        )
        let queued = try await publisher.enqueue(
            session: original,
            jobID: "synthetic-title-recovery-job"
        )

        do {
            _ = try await publisher.resume(jobID: queued.jobID)
            XCTFail("Expected the synthetic committed-response failure.")
        } catch {}
        let renamed = try NativeReviewEditor.setTitle(
            in: original,
            title: "Synthetic renamed after ambiguous create"
        )
        try repository.saveSession(renamed)

        let ready = try await publisher.resume(jobID: queued.jobID)

        XCTAssertEqual(ready.phase, .readyAsDraft)
        XCTAssertEqual(ready.createTitle, original.title)
        XCTAssertEqual(ready.remoteTitle, renamed.title)
        XCTAssertEqual(
            gateway.remoteTitle(objectID: try XCTUnwrap(ready.contentObjectID)),
            renamed.title
        )
        XCTAssertEqual(gateway.remoteCounts.objects, 1)
    }

    func testPublisherPersistsLegacyCreateTitleBeforeFirstRemoteRequest() async throws {
        let original = makeSession(
            state: .publishable,
            review: .approved,
            assetState: .publishableLocal,
            stepReview: .approved
        )
        let seedRepository = MemoryNativePublishRepository(assets: [
            "assets/publishable.png": Data([1, 2, 3]),
        ])
        let queued = try await DurableNativePublisher(
            repository: seedRepository,
            gateway: MockNativeAtriumGateway()
        ).enqueue(
            session: original,
            jobID: "synthetic-legacy-title-job"
        )
        let renamed = try NativeReviewEditor.setTitle(
            in: original,
            title: "Synthetic legacy title at first attempt"
        )
        let repository = MemoryNativePublishRepository(assets: [
            "assets/publishable.png": Data([1, 2, 3]),
        ])
        try repository.saveSession(renamed)
        try repository.saveJob(queued.with(createTitle: .some(nil)))
        let gateway = MockNativeAtriumGateway(failAfterCommitAt: .object)
        let publisher = DurableNativePublisher(repository: repository, gateway: gateway)

        do {
            _ = try await publisher.resume(jobID: queued.jobID)
            XCTFail("Expected the synthetic committed-response failure.")
        } catch {}

        let frozen = try XCTUnwrap(repository.loadJob(jobID: queued.jobID))
        XCTAssertEqual(frozen.createTitle, renamed.title)
        try repository.saveJob(frozen.with(createTitle: .some("Synthetic unsafe replacement")))
        XCTAssertEqual(
            try repository.loadJob(jobID: queued.jobID)?.createTitle,
            renamed.title
        )
    }

    func testPublisherRetriesInterruptedTitleUpdateWithoutRecreatingDraft() async throws {
        let repository = MemoryNativePublishRepository(assets: [
            "assets/publishable.png": Data([1, 2, 3]),
        ])
        let gateway = MockNativeAtriumGateway(failAfterCommitAt: .titleUpdate)
        let publisher = DurableNativePublisher(repository: repository, gateway: gateway)
        let original = makeSession(
            state: .publishable,
            review: .approved,
            assetState: .publishableLocal,
            stepReview: .approved
        )
        let queued = try await publisher.enqueue(session: original)
        let ready = try await publisher.resume(jobID: queued.jobID)
        let renamed = try NativeReviewEditor.setTitle(
            in: try XCTUnwrap(repository.loadSession(sessionID: ready.sessionID)),
            title: "Synthetic retryable title update"
        )
        try repository.saveSession(renamed)

        let interruptedValue = await publisher.syncTitle(jobID: ready.jobID)
        let recoveredValue = await publisher.syncTitle(jobID: ready.jobID)
        let interrupted = try XCTUnwrap(interruptedValue)
        let recovered = try XCTUnwrap(recoveredValue)

        XCTAssertEqual(interrupted.lastError?.code, "TITLE_UPDATE_FAILED")
        XCTAssertTrue(interrupted.lastError?.retryable == true)
        XCTAssertNil(recovered.lastError)
        XCTAssertEqual(recovered.remoteTitle, renamed.title)
        XCTAssertEqual(gateway.remoteCounts.objects, 1)
        XCTAssertEqual(gateway.remoteCounts.versions, 1)
    }

    func testPublisherReconcilesTitleAfterRecoveringInProgressPhase() async throws {
        let repository = MemoryNativePublishRepository(assets: [
            "assets/publishable.png": Data([1, 2, 3]),
        ])
        let gateway = MockNativeAtriumGateway(failAfterCommitAt: .titleUpdate)
        let publisher = DurableNativePublisher(repository: repository, gateway: gateway)
        let original = makeSession(
            state: .publishable,
            review: .approved,
            assetState: .publishableLocal,
            stepReview: .approved
        )
        let queued = try await publisher.enqueue(session: original)
        let ready = try await publisher.resume(jobID: queued.jobID)
        let renamed = try NativeReviewEditor.setTitle(
            in: try XCTUnwrap(repository.loadSession(sessionID: ready.sessionID)),
            title: "Synthetic restart-phase title update"
        )
        try repository.saveSession(renamed)
        try repository.saveJob(ready.with(phase: .uploadingAssets))

        let recovered = try await publisher.resume(jobID: queued.jobID)

        XCTAssertEqual(recovered.phase, .readyAsDraft)
        XCTAssertEqual(recovered.remoteTitle, renamed.title)
        XCTAssertNil(recovered.lastError)
        XCTAssertEqual(gateway.remoteCounts.objects, 1)
        XCTAssertEqual(gateway.remoteCounts.versions, 1)
    }

    func testSessionReconciliationNeverRegressesSubmittedStateDuringTitleSave() throws {
        let repository = MemoryNativePublishRepository()
        let original = makeSession(
            state: .publishable,
            review: .approved,
            assetState: .publishableLocal,
            stepReview: .approved
        )
        try repository.saveSession(original)
        let submitted = try repository.markSessionSubmitted(
            sessionID: original.sessionID,
            now: Date(timeIntervalSince1970: 1_001)
        )
        let staleRename = try NativeReviewEditor.setTitle(
            in: original,
            title: "Synthetic title saved during submit",
            now: Date(timeIntervalSince1970: 1_002)
        )

        let reconciled = try repository.reconcileSession(staleRename)
        let renamedAgain = try repository.updateSessionTitle(
            sessionID: original.sessionID,
            title: "Synthetic final submitted title",
            now: Date(timeIntervalSince1970: 1_003)
        )

        XCTAssertEqual(submitted.state, .submitted)
        XCTAssertEqual(reconciled.state, .submitted)
        XCTAssertEqual(reconciled.title, staleRename.title)
        XCTAssertGreaterThan(reconciled.revision, staleRename.revision)
        XCTAssertEqual(renamedAgain.state, .submitted)
        XCTAssertEqual(renamedAgain.title, "Synthetic final submitted title")
    }

    func testPublisherCannotEnqueueRawOrUnreviewedSession() async throws {
        let repository = MemoryNativePublishRepository()
        let publisher = DurableNativePublisher(repository: repository, gateway: MockNativeAtriumGateway())
        do {
            _ = try await publisher.enqueue(
                session: makeSession(
                    state: .review,
                    review: .inReview,
                    assetState: .rawLocal,
                    stepReview: .flagged
                )
            )
            XCTFail("Expected review-required rejection.")
        } catch {}
        do {
            _ = try await publisher.enqueue(
                session: makeSession(
                    state: .publishable,
                    review: .approved,
                    assetState: .rawLocal,
                    stepReview: .approved
                )
            )
            XCTFail("Expected raw-asset rejection.")
        } catch {
            XCTAssertEqual(error as? NativePublishError, .rawAssetRejected)
        }
        do {
            _ = try await publisher.enqueue(
                session: makeSession(
                    state: .publishable,
                    review: .approved,
                    assetState: .publishableLocal,
                    stepReview: .approved,
                    action: .input
                )
            )
            XCTFail("Expected sensitive-step review rejection.")
        } catch {
            XCTAssertEqual(error as? NativePublishError, .reviewRequired)
        }
    }

    func testPublisherExcludesRetainedRawBytesAndDeletesThemAfterDraftCommit() async throws {
        let repository = MemoryNativePublishRepository(assets: [
            "assets/publishable.png": Data([1, 2, 3]),
            "assets/retained-raw.png": Data("SYNTHETIC-RAW-NEVER-UPLOAD".utf8),
        ])
        let gateway = MockNativeAtriumGateway()
        let publisher = DurableNativePublisher(repository: repository, gateway: gateway)
        let job = try await publisher.enqueue(
            session: makeSession(
                state: .publishable,
                review: .approved,
                assetState: .publishableLocal,
                stepReview: .approved,
                rawRetention: .deleteAfterSubmit,
                includeRetainedRaw: true
            )
        )
        let ready = try await publisher.resume(jobID: job.jobID)
        let stored = try XCTUnwrap(repository.loadSession(sessionID: ready.sessionID))

        XCTAssertEqual(ready.phase, .readyAsDraft)
        XCTAssertEqual(stored.state, .submitted)
        XCTAssertEqual(stored.assets.first(where: { $0.localKey == "assets/retained-raw.png" })?.state, .deleted)
        XCTAssertThrowsError(try repository.assetData(localKey: "assets/retained-raw.png"))
        XCTAssertEqual(gateway.remoteCounts.assets, 1)
    }

    func testResumePendingRestoresTerminalDraftWithoutRepeatingRemoteWrites() async throws {
        let repository = MemoryNativePublishRepository(assets: [
            "assets/publishable.png": Data([1, 2, 3]),
        ])
        let gateway = MockNativeAtriumGateway()
        let publisher = DurableNativePublisher(repository: repository, gateway: gateway)
        let job = try await publisher.enqueue(
            session: makeSession(
                state: .publishable,
                review: .approved,
                assetState: .publishableLocal,
                stepReview: .approved
            )
        )
        let ready = try await publisher.resume(jobID: job.jobID)
        let countsBeforeRestart = gateway.remoteCounts

        let recovered = await DurableNativePublisher(
            repository: repository,
            gateway: gateway
        ).resumePending()

        XCTAssertEqual(recovered.map(\.jobID), [ready.jobID])
        XCTAssertEqual(recovered.first?.phase, .readyAsDraft)
        XCTAssertEqual(gateway.remoteCounts.objects, countsBeforeRestart.objects)
        XCTAssertEqual(gateway.remoteCounts.assets, countsBeforeRestart.assets)
        XCTAssertEqual(gateway.remoteCounts.versions, countsBeforeRestart.versions)
    }

    func testFileOutboxSurvivesRestartAndDeletesRetainedRawBytesAfterDraftCommit() async throws {
        let root = FileManager.default.temporaryDirectory
            .appendingPathComponent("atrium-capture-file-outbox-\(UUID().uuidString)", isDirectory: true)
        defer { try? FileManager.default.removeItem(at: root) }
        let assets = root.appendingPathComponent("assets", isDirectory: true)
        try FileManager.default.createDirectory(at: assets, withIntermediateDirectories: true)
        let publishableURL = assets.appendingPathComponent("publishable.png")
        let retainedRawURL = assets.appendingPathComponent("retained-raw.png")
        try Data([1, 2, 3]).write(to: publishableURL, options: .atomic)
        try Data("SYNTHETIC-RAW-NEVER-UPLOAD".utf8).write(to: retainedRawURL, options: .atomic)

        let gateway = MockNativeAtriumGateway()
        let firstRepository = FileNativePublishRepository(rootURL: root)
        let queued = try await DurableNativePublisher(
            repository: firstRepository,
            gateway: gateway
        ).enqueue(
            session: makeSession(
                state: .publishable,
                review: .approved,
                assetState: .publishableLocal,
                stepReview: .approved,
                rawRetention: .deleteAfterSubmit,
                includeRetainedRaw: true
            ),
            jobID: "file-restart-job"
        )

        let restartedRepository = FileNativePublishRepository(rootURL: root)
        let recovered = await DurableNativePublisher(
            repository: restartedRepository,
            gateway: gateway
        ).resumePending()
        let ready = try XCTUnwrap(recovered.first(where: { $0.jobID == queued.jobID }))
        let stored = try XCTUnwrap(restartedRepository.loadSession(sessionID: ready.sessionID))

        XCTAssertEqual(ready.phase, .readyAsDraft)
        XCTAssertEqual(stored.state, .submitted)
        XCTAssertEqual(
            stored.assets.first(where: { $0.localKey == "assets/retained-raw.png" })?.state,
            .deleted
        )
        XCTAssertTrue(FileManager.default.fileExists(atPath: publishableURL.path))
        XCTAssertFalse(FileManager.default.fileExists(atPath: retainedRawURL.path))
        XCTAssertEqual(gateway.remoteCounts.assets, 1)
    }

    private func makeSession(
        state: AtriumCaptureSessionState,
        review: ReviewStatus,
        assetState: AssetState,
        stepReview: PrivacyReview,
        action: Action = .click,
        rawRetention: RawImageRetention = .deleteAfterFlatten,
        includeRetainedRaw: Bool = false
    ) -> AtriumCaptureSession {
        let assetID = "30000000-0000-4000-8000-000000000010"
        let now = Date(timeIntervalSince1970: 1_000)
        var assets = [AssetElement(
            annotations: [],
            assetID: assetID,
            derivedFromAssetID: assetState == .publishableLocal ? "raw-source" : nil,
            localKey: "assets/publishable.png",
            mimeType: .imagePNG,
            pixelHeight: 20,
            pixelWidth: 20,
            sha256: String(repeating: "a", count: 64),
            state: assetState
        )]
        if includeRetainedRaw {
            assets.append(AssetElement(
                annotations: [],
                assetID: "30000000-0000-4000-8000-000000000099",
                derivedFromAssetID: nil,
                localKey: "assets/retained-raw.png",
                mimeType: .imagePNG,
                pixelHeight: 20,
                pixelWidth: 20,
                sha256: String(repeating: "c", count: 64),
                state: .rawLocal
            ))
        }
        return AtriumCaptureSession(
            assets: assets,
            createdAt: now,
            policy: Policy(
                denyReason: nil,
                policyVersion: "test-v1",
                rawImageRetention: rawRetention,
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
