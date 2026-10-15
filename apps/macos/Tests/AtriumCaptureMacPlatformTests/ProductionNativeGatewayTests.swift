#if os(macOS)
import AtriumCaptureCore
import Foundation
import XCTest
@testable import AtriumCaptureMacPlatform

final class ProductionNativeGatewayTests: XCTestCase {
    func testOAuthCallbackCanResumeFromAuthenticationServicesQueue() async throws {
        let callbackURL = try XCTUnwrap(
            URL(string: "org.psd401.atrium-capture:/oauth/callback?code=synthetic&state=state")
        )
        let returnedURL = try await withCheckedThrowingContinuation {
            (continuation: CheckedContinuation<URL, any Error>) in
            let callback = NativeOAuthSession.authorizationCallback(continuation: continuation)
            DispatchQueue.global(qos: .userInitiated).async {
                callback(callbackURL, nil)
            }
        }

        XCTAssertEqual(returnedURL, callbackURL)
    }

    func testDocumentedProductionContractKeepsAuthOffDirectUpload() async throws {
        let transport = SyntheticAtriumTransport()
        let gateway = try ProductionNativeAtriumGateway(transport: transport) {
            "synthetic-access-token"
        }
        let sourceRef = NativeCaptureSourceRef(
            capturedAt: Date(timeIntervalSince1970: 1_753_387_200),
            clientVersion: "1.0.0",
            externalID: sessionID
        )
        let draft = try await gateway.createPrivateDraft(
            title: "Synthetic native guide",
            sourceRef: sourceRef,
            collectionID: collectionID,
            idempotencyKey: "object:synthetic-job"
        )
        let renamed = try await gateway.updateTitle(
            objectID: draft.objectID,
            title: "Synthetic renamed native guide"
        )
        let asset = try await gateway.uploadPublishableAsset(
            objectID: draft.objectID,
            localAssetID: localAssetID,
            pngData: Data("synthetic-reviewed-image".utf8),
            pixelWidth: 1280,
            pixelHeight: 720,
            sha256: syntheticAssetDigestHex,
            idempotencyKey: "asset:synthetic-job"
        )
        let markdown = "# Synthetic\n\n"
            + (try gateway.formatAssetMarkdown(remoteAssetID: asset.assetID, altText: "Reviewed"))
        let version = try await gateway.createVersion(
            objectID: draft.objectID,
            markdown: markdown,
            idempotencyKey: "version:synthetic-job"
        )
        try await gateway.publishInternal(
            objectID: draft.objectID,
            versionID: version.versionID,
            idempotencyKey: "publish:synthetic-job"
        )

        let requests = await transport.requests
        let create = try XCTUnwrap(requests.first {
            $0.url?.path == "/api/v1/content" && $0.httpMethod == "POST"
        })
        let createBody = try XCTUnwrap(
            JSONSerialization.jsonObject(with: try XCTUnwrap(create.httpBody)) as? [String: Any]
        )
        XCTAssertEqual((createBody["visibility"] as? [String: String])?["level"], "private")
        XCTAssertNil(createBody["body"])
        XCTAssertEqual(
            (createBody["sourceRef"] as? [String: Any])?["clientSurface"] as? String,
            "mac"
        )
        XCTAssertEqual(create.value(forHTTPHeaderField: "Idempotency-Key"), "object:synthetic-job")
        let titleUpdate = try XCTUnwrap(requests.first {
            $0.url?.path == "/api/v1/content/\(objectID)" && $0.httpMethod == "PATCH"
        })
        let titleBody = try XCTUnwrap(
            JSONSerialization.jsonObject(with: try XCTUnwrap(titleUpdate.httpBody)) as? [String: Any]
        )
        XCTAssertEqual(titleBody["title"] as? String, "Synthetic renamed native guide")
        XCTAssertEqual(renamed.objectID, objectID)
        XCTAssertEqual(renamed.title, "Synthetic renamed native guide")

        let upload = try XCTUnwrap(requests.first { $0.url?.host?.contains("amazonaws.com") == true })
        XCTAssertNil(upload.value(forHTTPHeaderField: "Authorization"))
        XCTAssertEqual(
            Set(upload.allHTTPHeaderFields?.keys.map { $0.lowercased() } ?? []),
            Set(["content-type"])
        )
        let initiate = try XCTUnwrap(requests.first {
            $0.url?.path.hasSuffix("/assets") == true && $0.httpMethod == "POST"
        })
        XCTAssertEqual(
            initiate.value(forHTTPHeaderField: "Idempotency-Key"),
            "asset:synthetic-job"
        )
        let versionRequest = try XCTUnwrap(requests.first { $0.url?.path.hasSuffix("/versions") == true })
        XCTAssertEqual(versionRequest.value(forHTTPHeaderField: "If-Match"), "\"none\"")
        let publish = try XCTUnwrap(requests.first { $0.url?.path.hasSuffix("/publish") == true })
        XCTAssertEqual(
            publish.value(forHTTPHeaderField: "If-Match"),
            "\"\(versionID)\""
        )
        XCTAssertEqual(
            version.readerURL,
            "https://aistudio.psd401.ai/atrium/\(objectID)/edit"
        )
    }

    func testProductionSettingsUsePublicManagedConfigurationAndDocumentedCallback() throws {
        let suite = try XCTUnwrap(UserDefaults(suiteName: "ProductionNativeGatewayTests"))
        suite.removePersistentDomain(forName: "ProductionNativeGatewayTests")
        suite.set(clientID, forKey: "AtriumOAuthClientId")
        suite.set(collectionID, forKey: "AtriumDefaultCollectionId")
        let settings = try XCTUnwrap(
            NativeAtriumProductionSettings.load(
                environment: [:],
                defaults: suite,
                bundle: Bundle(for: Self.self)
            )
        )

        XCTAssertEqual(settings.oauth.clientID, clientID)
        XCTAssertEqual(settings.oauth.redirectScheme, "org.psd401.atrium-capture")
        XCTAssertEqual(settings.oauth.resourceServer, atriumProductionOrigin)
        XCTAssertEqual(settings.defaultCollectionID, collectionID)
        XCTAssertEqual(settings.oauth.tokenEndpoint.absoluteString, "https://aistudio.psd401.ai/api/oauth/token")
        let authorizationURL = try NativeOAuthSession.authorizationURL(
            configuration: settings.oauth,
            codeChallenge: String(repeating: "a", count: 43),
            state: "synthetic-state"
        )
        let queryItems = try XCTUnwrap(
            URLComponents(url: authorizationURL, resolvingAgainstBaseURL: false)?.queryItems
        )
        XCTAssertEqual(
            queryItems.first(where: { $0.name == "resource" })?.value,
            atriumProductionOrigin.absoluteString
        )
    }

    func testProductionSettingsParseGuideWriterAssistantIDAndAIGuideWritingFlag() throws {
        let settings = try XCTUnwrap(
            NativeAtriumProductionSettings.load(
                environment: [
                    "ATRIUM_CAPTURE_GUIDE_WRITER_ASSISTANT_ID": "7",
                    "ATRIUM_CAPTURE_AI_GUIDE_WRITING": "off",
                ],
                defaults: try XCTUnwrap(UserDefaults(suiteName: "ProductionNativeGatewayGuideWriterTests")),
                bundle: Bundle(for: Self.self)
            )
        )

        XCTAssertEqual(settings.guideWriterAssistantID, 7)
        XCTAssertFalse(settings.aiGuideWritingEnabled)
    }

    func testProductionSettingsRejectInvalidAIGuideWritingValue() {
        XCTAssertNil(
            NativeAtriumProductionSettings.load(
                environment: ["ATRIUM_CAPTURE_AI_GUIDE_WRITING": "maybe"],
                defaults: UserDefaults(suiteName: "ProductionNativeGatewayInvalidAIGuideWritingTests")!,
                bundle: Bundle(for: Self.self)
            )
        )
    }

    func testProductionSettingsUseBundledPublicClientWithoutUserConfiguration() throws {
        let suite = try XCTUnwrap(UserDefaults(suiteName: "ProductionNativeGatewayBundledTests"))
        suite.removePersistentDomain(forName: "ProductionNativeGatewayBundledTests")
        let settings = try XCTUnwrap(
            NativeAtriumProductionSettings.load(
                environment: [:],
                defaults: suite,
                bundle: Bundle(for: Self.self)
            )
        )

        XCTAssertEqual(settings.oauth.clientID, atriumMacProductionOAuthClientID)
        XCTAssertNil(settings.defaultCollectionID)
    }

    func testIdempotencyInProgressIsRetryableAndPreservesSupportRequestID() async throws {
        let gateway = try ProductionNativeAtriumGateway(
            transport: SyntheticFailureTransport()
        ) {
            "synthetic-access-token"
        }

        do {
            _ = try await gateway.createPrivateDraft(
                title: "Synthetic pending guide",
                sourceRef: NativeCaptureSourceRef(
                    capturedAt: Date(timeIntervalSince1970: 1_753_387_200),
                    clientVersion: "1.0.0",
                    externalID: sessionID
                ),
                collectionID: nil,
                idempotencyKey: "object:synthetic-pending"
            )
            XCTFail("Expected the synthetic idempotency response.")
        } catch let failure as NativeGatewayFailure {
            XCTAssertEqual(failure.code, "IDEMPOTENCY_IN_PROGRESS")
            XCTAssertEqual(failure.requestID, "req_synthetic_pending")
            XCTAssertTrue(failure.retryable)
        }
    }

    func testNonJSONHTTPFailurePreservesStatusAndSupportRequestID() async throws {
        let gateway = try ProductionNativeAtriumGateway(
            transport: SyntheticNonJSONFailureTransport()
        ) {
            "synthetic-access-token"
        }

        do {
            _ = try await gateway.createPrivateDraft(
                title: "Synthetic forbidden guide",
                sourceRef: NativeCaptureSourceRef(
                    capturedAt: Date(timeIntervalSince1970: 1_753_387_200),
                    clientVersion: "1.0.0",
                    externalID: sessionID
                ),
                collectionID: nil,
                idempotencyKey: "object:synthetic-forbidden"
            )
            XCTFail("Expected the synthetic HTML error response.")
        } catch let failure as NativeGatewayFailure {
            XCTAssertEqual(failure.code, "ATRIUM_HTTP_403")
            XCTAssertEqual(failure.requestID, "req_synthetic_html")
            XCTAssertFalse(failure.retryable)
        }
    }

    func testUploadRejectsBytesThatDoNotMatchDeclaredDigestBeforeNetworkIO() async throws {
        let transport = SyntheticAtriumTransport()
        let gateway = try ProductionNativeAtriumGateway(transport: transport) {
            "synthetic-access-token"
        }

        do {
            _ = try await gateway.uploadPublishableAsset(
                objectID: objectID,
                localAssetID: localAssetID,
                pngData: Data("synthetic-reviewed-image".utf8),
                pixelWidth: 1280,
                pixelHeight: 720,
                sha256: String(repeating: "0", count: 64),
                idempotencyKey: "asset:synthetic-mismatch"
            )
            XCTFail("Expected the digest mismatch to fail closed.")
        } catch let failure as NativeGatewayFailure {
            XCTAssertEqual(failure.code, "ASSET_SHA256_MISMATCH")
            XCTAssertFalse(failure.retryable)
        }
        let requests = await transport.requests
        XCTAssertTrue(requests.isEmpty)
    }

    func testScopesIncludeAssistantExecute() {
        XCTAssertTrue(atriumOAuthScopes.contains("assistants:execute"))
    }

    func testGuideWriterExecutesThenPollsToCompletion() async throws {
        let transport = SyntheticAtriumTransport()
        let gateway = try ProductionNativeAtriumGateway(
            transport: transport,
            sleep: { _ in },
            accessToken: { "synthetic-token" }
        )
        let result = try await gateway.executeGuideWriter(assistantID: 42, steps: "{\"schemaVersion\":1}")
        XCTAssertEqual(result, NativeGuideWriterResult(jobID: "job-1", text: "{\"schemaVersion\":1}"))
        let requests = await transport.requests
        XCTAssertEqual(requests.first?.url?.path, "/api/v1/assistants/42/execute")
        XCTAssertEqual(requests.first?.value(forHTTPHeaderField: "Accept"), "application/json")
        let body = try XCTUnwrap(requests.first?.httpBody)
        let json = try XCTUnwrap(JSONSerialization.jsonObject(with: body) as? [String: Any])
        XCTAssertEqual((json["inputs"] as? [String: Any])?["steps"] as? String, "{\"schemaVersion\":1}")
        XCTAssertEqual(requests.filter { $0.url?.path == "/api/v1/jobs/job-1" }.count, 2)
    }

    func testGuideWriterMapsFailedJobAndBudget() async throws {
        let failing = SyntheticAtriumTransport(jobStatus: "failed")
        let gateway = try ProductionNativeAtriumGateway(transport: failing, sleep: { _ in }, accessToken: { "t" })
        await XCTAssertThrowsErrorAsync(try await gateway.executeGuideWriter(assistantID: 42, steps: "{}")) { error in
            XCTAssertEqual((error as? NativeGatewayFailure)?.code, "ATRIUM_JOB_FAILED")
            XCTAssertEqual((error as? NativeGatewayFailure)?.retryable, true)
        }

        nonisolated(unsafe) var now: TimeInterval = 0
        let slow = SyntheticAtriumTransport(jobStatus: "processing")
        let budgeted = try ProductionNativeAtriumGateway(
            transport: slow,
            clock: { now },
            sleep: { seconds in now += seconds },
            accessToken: { "t" }
        )
        await XCTAssertThrowsErrorAsync(try await budgeted.executeGuideWriter(assistantID: 42, steps: "{}")) { error in
            XCTAssertEqual((error as? NativeGatewayFailure)?.code, "ATRIUM_JOB_TIMEOUT")
        }
        XCTAssertGreaterThanOrEqual(now, 120)
    }
}

func XCTAssertThrowsErrorAsync<T>(
    _ expression: @autoclosure () async throws -> T,
    _ errorHandler: (_ error: Error) -> Void = { _ in },
    file: StaticString = #filePath,
    line: UInt = #line
) async {
    do {
        _ = try await expression()
        XCTFail("Expected an error to be thrown.", file: file, line: line)
    } catch {
        errorHandler(error)
    }
}

private actor SyntheticFailureTransport: NativeHTTPTransport {
    func data(for request: URLRequest) async throws -> (Data, URLResponse) {
        let url = try XCTUnwrap(request.url)
        let data = try JSONSerialization.data(withJSONObject: [
            "error": [
                "code": "IDEMPOTENCY_IN_PROGRESS",
                "message": "Synthetic request is still pending.",
            ],
            "requestId": "req_synthetic_pending",
        ])
        let response = try XCTUnwrap(HTTPURLResponse(
            url: url,
            statusCode: 409,
            httpVersion: "HTTP/1.1",
            headerFields: [
                "Content-Type": "application/json",
                "X-Request-Id": "req_synthetic_pending",
            ]
        ))
        return (data, response)
    }
}

private actor SyntheticNonJSONFailureTransport: NativeHTTPTransport {
    func data(for request: URLRequest) async throws -> (Data, URLResponse) {
        let url = try XCTUnwrap(request.url)
        let response = try XCTUnwrap(HTTPURLResponse(
            url: url,
            statusCode: 403,
            httpVersion: "HTTP/1.1",
            headerFields: [
                "Content-Type": "text/html",
                "X-Request-Id": "req_synthetic_html",
            ]
        ))
        return (Data("<html>synthetic forbidden</html>".utf8), response)
    }
}

private actor SyntheticAtriumTransport: NativeHTTPTransport {
    private(set) var requests: [URLRequest] = []
    private let jobStatus: String
    private var polls = 0

    init(jobStatus: String = "completed") {
        self.jobStatus = jobStatus
    }

    func data(for request: URLRequest) async throws -> (Data, URLResponse) {
        requests.append(request)
        let url = try XCTUnwrap(request.url)
        if url.host?.contains("amazonaws.com") == true {
            return response(url: url, status: 200, body: nil)
        }
        switch (request.httpMethod ?? "GET", url.path) {
        case ("POST", "/api/v1/content"):
            return response(url: url, status: 201, body: [
                "data": [
                    "id": objectID,
                    "slug": "synthetic-native-guide",
                    "visibilityLevel": "private",
                    "currentVersionId": NSNull(),
                ],
            ])
        case ("GET", "/api/v1/content/\(objectID)/assets"):
            return response(url: url, status: 200, body: ["data": []])
        case ("POST", "/api/v1/content/\(objectID)/assets"):
            return response(url: url, status: 201, body: [
                "data": assetRecord(state: "pending").merging([
                    "upload": [
                        "method": "PUT",
                        "url": hoistedUploadURL,
                        "headers": [
                            "content-type": "image/png",
                            "x-amz-checksum-sha256": syntheticAssetDigestBase64,
                        ],
                        "expiresAt": "2026-07-24T20:15:00.000Z",
                    ],
                ]) { _, new in new },
            ])
        case ("POST", "/api/v1/content/\(objectID)/assets/\(assetID)/complete"):
            return response(url: url, status: 200, body: ["data": assetRecord(state: "ready")])
        case ("POST", "/api/v1/content/\(objectID)/versions"):
            return response(url: url, status: 201, body: [
                "data": [
                    "currentVersionId": versionID,
                    "slug": "synthetic-native-guide",
                    "version": ["id": versionID],
                ],
            ])
        case ("PATCH", "/api/v1/content/\(objectID)"):
            return response(url: url, status: 200, body: [
                "data": [
                    "id": objectID,
                    "title": "Synthetic renamed native guide",
                ],
            ])
        case ("POST", "/api/v1/content/\(objectID)/publish"):
            return response(url: url, status: 200, body: [
                "data": [
                    "id": objectID,
                    "destination": "intranet",
                    "publishedVersionId": versionID,
                ],
            ])
        case ("POST", "/api/v1/assistants/42/execute"):
            return response(url: url, status: 202, body: [
                "data": ["jobId": "job-1", "status": "pending", "pollUrl": "/api/v1/jobs/job-1"],
            ])
        case ("GET", "/api/v1/jobs/job-1"):
            polls += 1
            if jobStatus == "completed" && polls < 2 {
                return response(url: url, status: 200, body: ["data": ["status": "processing", "pollingInterval": 1]])
            }
            var data: [String: Any] = ["status": jobStatus, "pollingInterval": 10_000]
            if jobStatus == "completed" { data["responseData"] = ["text": "{\"schemaVersion\":1}"] }
            if jobStatus == "failed" { data["errorMessage"] = "synthetic" }
            return response(url: url, status: 200, body: ["data": data])
        default:
            return response(url: url, status: 404, body: [
                "error": ["code": "NOT_FOUND", "message": "Synthetic route missing."],
            ])
        }
    }

    private func response(
        url: URL,
        status: Int,
        body: [String: Any]?
    ) -> (Data, URLResponse) {
        let data = body.map { try! JSONSerialization.data(withJSONObject: $0) } ?? Data()
        let response = HTTPURLResponse(
            url: url,
            statusCode: status,
            httpVersion: "HTTP/1.1",
            headerFields: ["Content-Type": "application/json"]
        )!
        return (data, response)
    }

    private func assetRecord(state: String) -> [String: Any] {
        [
            "id": assetID,
            "objectId": objectID,
            "filename": "atrium-capture-\(localAssetID).png",
            "contentType": "image/png",
            "byteLength": Data("synthetic-reviewed-image".utf8).count,
            "sha256": syntheticAssetDigestBase64URL,
            "purpose": "capture_step",
            "state": state,
            "width": 1280,
            "height": 720,
            "uploadExpiresAt": "2026-07-24T20:15:00.000Z",
            "embedRef": "::atrium-asset{id=\"\(assetID)\" alt=\"\"}",
        ]
    }
}

private let clientID = "70000000-0000-4000-8000-000000000001"
private let collectionID = "60000000-0000-4000-8000-000000000001"
private let sessionID = "10000000-0000-4000-8000-000000000001"
private let objectID = "a1000000-0000-4000-8000-000000000001"
private let localAssetID = "a3000000-0000-4000-8000-000000000001"
private let assetID = "a2000000-0000-4000-8000-000000000001"
private let versionID = "a4000000-0000-4000-8000-000000000001"
private let hoistedUploadURL =
    "https://synthetic-bucket.s3.us-west-2.amazonaws.com/upload"
        + "?X-Amz-Checksum-Sha256=k3UW6sWEhEdP%2B3ulJIlxs2euQtJYwhvGpFRIDtvMWe8%3D"
        + "&X-Amz-SignedHeaders=content-length%3Bhost&X-Amz-Signature=fake"
private let syntheticAssetDigestHex =
    "937516eac58484474ffb7ba5248971b367ae42d258c21bc6a454480edbcc59ef"
private let syntheticAssetDigestBase64 = "k3UW6sWEhEdP+3ulJIlxs2euQtJYwhvGpFRIDtvMWe8="
private let syntheticAssetDigestBase64URL = "k3UW6sWEhEdP-3ulJIlxs2euQtJYwhvGpFRIDtvMWe8"
#endif
