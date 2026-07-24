#if os(macOS)
import AtriumCaptureCore
import Foundation
import XCTest
@testable import AtriumCaptureMacPlatform

final class ProductionNativeGatewayTests: XCTestCase {
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
        let asset = try await gateway.uploadPublishableAsset(
            objectID: draft.objectID,
            localAssetID: localAssetID,
            pngData: Data("synthetic-reviewed-image".utf8),
            pixelWidth: 1280,
            pixelHeight: 720,
            sha256: String(repeating: "0", count: 64),
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

        let upload = try XCTUnwrap(requests.first { $0.url?.host?.contains("amazonaws.com") == true })
        XCTAssertNil(upload.value(forHTTPHeaderField: "Authorization"))
        XCTAssertEqual(
            Set(upload.allHTTPHeaderFields?.keys.map { $0.lowercased() } ?? []),
            Set(["content-type", "x-amz-checksum-sha256"])
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
            "https://aistudio.psd401.ai/c/synthetic-native-guide"
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
        XCTAssertEqual(settings.defaultCollectionID, collectionID)
        XCTAssertEqual(settings.oauth.tokenEndpoint.absoluteString, "https://aistudio.psd401.ai/api/oauth/token")
    }
}

private actor SyntheticAtriumTransport: NativeHTTPTransport {
    private(set) var requests: [URLRequest] = []

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
                        "url": "https://synthetic-bucket.s3.us-west-2.amazonaws.com/upload?signature=fake",
                        "headers": [
                            "content-type": "image/png",
                            "x-amz-checksum-sha256": "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=",
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
        case ("POST", "/api/v1/content/\(objectID)/publish"):
            return response(url: url, status: 200, body: [
                "data": [
                    "id": objectID,
                    "destination": "intranet",
                    "publishedVersionId": versionID,
                ],
            ])
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
            "sha256": "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
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
#endif
