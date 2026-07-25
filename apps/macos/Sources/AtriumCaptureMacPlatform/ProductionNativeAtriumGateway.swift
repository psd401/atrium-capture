import AtriumCaptureContracts
import AtriumCaptureCore
import Foundation

#if os(macOS)
import CryptoKit

public let atriumProductionOrigin = URL(string: "https://aistudio.psd401.ai")!
public let atriumMacProductionOAuthClientID = "fbdaa815-1b0f-435b-805f-1732805720c1"
public let atriumMacOAuthRedirectScheme = "org.psd401.atrium-capture"
public let atriumOAuthScopes = [
    "openid",
    "profile",
    "offline_access",
    "content:read",
    "content:create",
    "content:update",
    "content:publish_internal",
]

public struct NativeAtriumProductionSettings: Sendable {
    public let oauth: NativeOAuthConfiguration
    public let defaultCollectionID: String?

    public init(oauth: NativeOAuthConfiguration, defaultCollectionID: String?) {
        self.oauth = oauth
        self.defaultCollectionID = defaultCollectionID
    }

    public static func load(
        environment: [String: String] = ProcessInfo.processInfo.environment,
        defaults: UserDefaults = .standard,
        bundle: Bundle = .main
    ) -> NativeAtriumProductionSettings? {
        let clientID = firstNonempty(
            environment["ATRIUM_CAPTURE_OAUTH_CLIENT_ID"],
            defaults.string(forKey: "AtriumOAuthClientId"),
            bundle.object(forInfoDictionaryKey: "AtriumOAuthClientId") as? String,
            atriumMacProductionOAuthClientID
        )
        guard let clientID, UUID(uuidString: clientID) != nil else { return nil }
        let collectionID = firstNonempty(
            environment["ATRIUM_CAPTURE_DEFAULT_COLLECTION_ID"],
            defaults.string(forKey: "AtriumDefaultCollectionId"),
            bundle.object(forInfoDictionaryKey: "AtriumDefaultCollectionId") as? String
        )
        if let collectionID, UUID(uuidString: collectionID) == nil {
            return nil
        }
        guard let oauth = try? NativeOAuthConfiguration(
            authorizationEndpoint: atriumProductionOrigin.appending(path: "api/oauth/auth"),
            tokenEndpoint: atriumProductionOrigin.appending(path: "api/oauth/token"),
            revocationEndpoint: atriumProductionOrigin.appending(path: "api/oauth/revocation"),
            clientID: clientID,
            redirectScheme: atriumMacOAuthRedirectScheme,
            resourceServer: atriumProductionOrigin,
            scopes: atriumOAuthScopes
        ) else { return nil }
        return NativeAtriumProductionSettings(oauth: oauth, defaultCollectionID: collectionID)
    }
}

public protocol NativeHTTPTransport: Sendable {
    func data(for request: URLRequest) async throws -> (Data, URLResponse)
}

extension URLSession: NativeHTTPTransport {}

public final class ProductionNativeAtriumGateway: NativeAtriumGateway, @unchecked Sendable {
    public let capabilities = NativeAtriumCapabilities(
        oauth: true,
        privateDrafts: true,
        assetUpload: true,
        versionCreation: true,
        internalPublish: true,
        titleUpdate: true,
        blocker: nil
    )

    private let accessToken: @Sendable () async throws -> String
    private let transport: any NativeHTTPTransport
    private let origin: URL
    private let apiBase: URL

    public init(
        origin: URL = atriumProductionOrigin,
        transport: any NativeHTTPTransport = URLSession.shared,
        accessToken: @escaping @Sendable () async throws -> String
    ) throws {
        guard origin.scheme == "https",
              origin.user == nil,
              origin.password == nil,
              origin.query == nil,
              origin.fragment == nil
        else { throw NativeGatewayFailure(code: "ATRIUM_ORIGIN_INVALID", retryable: false) }
        self.origin = origin
        apiBase = origin.appending(path: "api/v1")
        self.transport = transport
        self.accessToken = accessToken
    }

    public func createPrivateDraft(
        title: String,
        sourceRef: NativeCaptureSourceRef,
        collectionID: String?,
        idempotencyKey: String
    ) async throws -> NativeDraftResult {
        var sourceRef: [String: Any] = [
            "type": "capture",
            "provider": "atrium-capture",
            "externalId": sourceRef.externalID,
            "clientSurface": "mac",
            "clientVersion": sourceRef.clientVersion,
            "capturedAt": Self.formatDate(sourceRef.capturedAt),
        ]
        // macOS Accessibility context never enters browser-origin provenance.
        sourceRef.removeValue(forKey: "sourceOrigins")
        var body: [String: Any] = [
            "kind": "document",
            "title": title,
            "visibility": ["level": "private"],
            "tags": ["atrium-capture"],
            "sourceRef": sourceRef,
        ]
        if let collectionID { body["collectionId"] = collectionID }
        let response = try await apiJSON(
            path: "content",
            method: "POST",
            body: body,
            headers: ["Idempotency-Key": idempotencyKey]
        )
        let data = try Self.dataRecord(response)
        guard Self.string(data["visibilityLevel"], maximum: 32) == "private",
              data["currentVersionId"] is NSNull
        else { throw Self.invalidResponse() }
        return NativeDraftResult(objectID: try Self.uuid(data["id"]))
    }

    public func formatAssetMarkdown(remoteAssetID: String, altText: String) throws -> String {
        let assetID = try Self.uuid(remoteAssetID)
        let cleanAlt = altText
            .replacingOccurrences(of: "\r", with: " ")
            .replacingOccurrences(of: "\n", with: " ")
            .replacingOccurrences(of: "\"", with: " ")
            .trimmingCharacters(in: .whitespaces)
        return "::atrium-asset{id=\"\(assetID)\" alt=\"\(cleanAlt.prefix(500))\"}"
    }

    public func uploadPublishableAsset(
        objectID: String,
        localAssetID: String,
        pngData: Data,
        pixelWidth: Int,
        pixelHeight: Int,
        sha256: String,
        idempotencyKey: String
    ) async throws -> NativeAssetResult {
        guard !pngData.isEmpty,
              pngData.count <= 20 * 1_024 * 1_024,
              (1...12_000).contains(pixelWidth),
              (1...12_000).contains(pixelHeight)
        else { throw NativeGatewayFailure(code: "ASSET_INVALID", retryable: false) }
        let objectID = try Self.uuid(objectID)
        let localAssetID = try Self.uuid(localAssetID)
        let actualSHA256 = SHA256.hash(data: pngData)
            .map { String(format: "%02x", $0) }
            .joined()
        guard actualSHA256 == sha256.lowercased() else {
            throw NativeGatewayFailure(code: "ASSET_SHA256_MISMATCH", retryable: false)
        }
        let digest = try Self.base64URLDigest(hex: sha256)
        let filename = "atrium-capture-\(localAssetID).png"

        if let existing = try await findExistingAsset(
            objectID: objectID,
            filename: filename,
            byteLength: pngData.count,
            digest: digest,
            pixelWidth: pixelWidth,
            pixelHeight: pixelHeight
        ) {
            if existing.state == "ready" {
                return NativeAssetResult(assetID: existing.id)
            }
        }

        let initiated = try await initiateAsset(
            objectID: objectID,
            localAssetID: localAssetID,
            filename: filename,
            pngData: pngData,
            digest: digest,
            pixelWidth: pixelWidth,
            pixelHeight: pixelHeight,
            idempotencyKey: idempotencyKey
        )
        var uploadRequest = URLRequest(url: try Self.validUploadURL(initiated.uploadURL))
        uploadRequest.httpMethod = "PUT"
        uploadRequest.httpBody = pngData
        uploadRequest.setValue(initiated.contentTypeHeader, forHTTPHeaderField: "content-type")
        if initiated.sendChecksumHeader {
            uploadRequest.setValue(
                initiated.checksumHeader,
                forHTTPHeaderField: "x-amz-checksum-sha256"
            )
        }
        var uploadFailure: Error?
        do {
            let (data, response) = try await transport.data(for: uploadRequest)
            guard data.count <= 1_000_000,
                  let http = response as? HTTPURLResponse
            else {
                throw NativeGatewayFailure(code: "ATRIUM_ASSET_UPLOAD_INVALID_RESPONSE", retryable: false)
            }
            guard (200..<300).contains(http.statusCode) else {
                let requestID = http.value(forHTTPHeaderField: "x-amz-request-id").flatMap {
                    $0.isEmpty || $0.count > 200 ? nil : $0
                }
                throw NativeGatewayFailure(
                    code: "ATRIUM_ASSET_UPLOAD_HTTP_\(http.statusCode)",
                    requestID: requestID,
                    retryable: http.statusCode == 408
                        || http.statusCode == 429
                        || http.statusCode >= 500
                )
            }
        } catch let failure as NativeGatewayFailure {
            uploadFailure = failure
        } catch {
            uploadFailure = NativeGatewayFailure(code: "ATRIUM_ASSET_UPLOAD_FAILED", retryable: true)
        }

        do {
            return try await completeAsset(
                objectID: objectID,
                assetID: initiated.asset.id,
                digest: digest
            )
        } catch {
            if let failure = uploadFailure as? NativeGatewayFailure { throw failure }
            throw error
        }
    }

    public func createVersion(
        objectID: String,
        markdown: String,
        idempotencyKey: String
    ) async throws -> NativeVersionResult {
        let objectID = try Self.uuid(objectID)
        let response = try await apiJSON(
            path: "content/\(objectID)/versions",
            method: "POST",
            body: [
                "body": markdown,
                "bodyFormat": "markdown",
                "summary": "Created by Atrium Capture after privacy review.",
            ],
            headers: [
                "Idempotency-Key": idempotencyKey,
                "If-Match": "\"none\"",
            ]
        )
        let data = try Self.dataRecord(response)
        let version = try Self.record(data["version"])
        let versionID = try Self.uuid(version["id"])
        guard try Self.uuid(data["currentVersionId"]) == versionID,
              let slug = Self.string(data["slug"], maximum: 500)
        else { throw Self.invalidResponse() }
        _ = slug
        return NativeVersionResult(
            versionID: versionID,
            readerURL: origin.appending(path: "atrium/\(objectID)/edit").absoluteString
        )
    }

    public func publishInternal(
        objectID: String,
        versionID: String,
        idempotencyKey: String
    ) async throws {
        let objectID = try Self.uuid(objectID)
        let versionID = try Self.uuid(versionID)
        let response = try await apiJSON(
            path: "content/\(objectID)/publish",
            method: "POST",
            body: ["destination": "intranet"],
            headers: [
                "Idempotency-Key": idempotencyKey,
                "If-Match": "\"\(versionID)\"",
            ]
        )
        let data = try Self.dataRecord(response)
        guard try Self.uuid(data["id"]) == objectID,
              try Self.uuid(data["publishedVersionId"]) == versionID,
              Self.string(data["destination"], maximum: 32) == "intranet"
        else { throw Self.invalidResponse() }
    }

    public func updateTitle(objectID: String, title: String) async throws -> NativeTitleResult {
        let objectID = try Self.uuid(objectID)
        let title = title.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !title.isEmpty, title.count <= 500 else {
            throw NativeGatewayFailure(code: "INVALID_TITLE", retryable: false)
        }
        let response = try await apiJSON(
            path: "content/\(objectID)",
            method: "PATCH",
            body: ["title": title]
        )
        let data = try Self.dataRecord(response)
        guard let confirmedTitle = Self.string(data["title"], maximum: 500) else {
            throw Self.invalidResponse()
        }
        return NativeTitleResult(
            objectID: try Self.uuid(data["id"]),
            title: confirmedTitle
        )
    }

    private func initiateAsset(
        objectID: String,
        localAssetID _: String,
        filename: String,
        pngData: Data,
        digest: String,
        pixelWidth: Int,
        pixelHeight: Int,
        idempotencyKey: String
    ) async throws -> InitiatedAsset {
        let response = try await apiJSON(
            path: "content/\(objectID)/assets",
            method: "POST",
            body: [
                "filename": filename,
                "contentType": "image/png",
                "byteLength": pngData.count,
                "sha256": digest,
                "purpose": "capture_step",
                "width": pixelWidth,
                "height": pixelHeight,
            ],
            headers: ["Idempotency-Key": idempotencyKey]
        )
        let data = try Self.dataRecord(response)
        let asset = try Self.asset(data)
        let upload = try Self.record(data["upload"])
        let headers = try Self.record(upload["headers"])
        guard asset.state == "pending",
              Self.string(upload["method"], maximum: 8) == "PUT",
              let uploadURL = Self.string(upload["url"], maximum: 8_192),
              let contentType = Self.string(headers["content-type"], maximum: 100),
              let checksum = Self.string(headers["x-amz-checksum-sha256"], maximum: 100),
              contentType == "image/png",
              Self.normalizedBase64Checksum(checksum) == digest
        else { throw Self.invalidResponse() }
        return InitiatedAsset(
            asset: asset,
            uploadURL: uploadURL,
            contentTypeHeader: contentType,
            checksumHeader: checksum,
            sendChecksumHeader: try Self.shouldSendChecksumHeader(
                uploadURL: uploadURL,
                returnedChecksum: checksum
            )
        )
    }

    private static func normalizedBase64Checksum(_ value: String) -> String? {
        guard value.range(
            of: "^[A-Za-z0-9+/]{43}=$",
            options: .regularExpression
        ) != nil else {
            return nil
        }
        return value
            .replacingOccurrences(of: "+", with: "-")
            .replacingOccurrences(of: "/", with: "_")
            .replacingOccurrences(of: "=", with: "")
    }

    /// S3 may integrity-bind the checksum as a signed query item or as an
    /// unhoisted signed header. Do not duplicate a hoisted checksum as an
    /// unsigned x-amz-* header; S3 rejects that otherwise valid request.
    private static func shouldSendChecksumHeader(
        uploadURL: String,
        returnedChecksum: String
    ) throws -> Bool {
        guard let components = URLComponents(string: uploadURL) else {
            throw NativeGatewayFailure(
                code: "ATRIUM_ASSET_UPLOAD_URL_INVALID",
                retryable: false
            )
        }
        let items = components.queryItems ?? []
        let checksumQuery = items.first {
            $0.name.lowercased() == "x-amz-checksum-sha256"
        }?.value
        if let checksumQuery, checksumQuery != returnedChecksum {
            throw NativeGatewayFailure(
                code: "ATRIUM_ASSET_CHECKSUM_TRANSPORT_MISMATCH",
                retryable: false
            )
        }
        let signedHeaders = Set(
            (
                items.first {
                    $0.name.lowercased() == "x-amz-signedheaders"
                }?.value ?? ""
            )
            .split(separator: ";")
            .map { $0.lowercased() }
        )
        return checksumQuery == nil || signedHeaders.contains("x-amz-checksum-sha256")
    }

    private func completeAsset(
        objectID: String,
        assetID: String,
        digest: String
    ) async throws -> NativeAssetResult {
        let response = try await apiJSON(
            path: "content/\(objectID)/assets/\(assetID)/complete",
            method: "POST",
            body: ["sha256": digest]
        )
        let asset = try Self.asset(Self.dataRecord(response))
        guard asset.id == assetID, asset.state == "ready" else {
            throw NativeGatewayFailure(code: "ATRIUM_ASSET_NOT_READY", retryable: true)
        }
        return NativeAssetResult(assetID: asset.id)
    }

    private func findExistingAsset(
        objectID: String,
        filename: String,
        byteLength: Int,
        digest: String,
        pixelWidth: Int,
        pixelHeight: Int
    ) async throws -> ContentAsset? {
        let response = try await apiJSON(path: "content/\(objectID)/assets", method: "GET")
        let record = try Self.record(response)
        guard let values = record["data"] as? [Any], values.count <= 10_000 else {
            throw Self.invalidResponse()
        }
        let matches = try values.map(Self.asset).filter {
            $0.filename == filename &&
                $0.contentType == "image/png" &&
                $0.byteLength == byteLength &&
                $0.sha256 == digest &&
                $0.purpose == "capture_step" &&
                $0.width == pixelWidth &&
                $0.height == pixelHeight
        }
        return matches.first(where: { $0.state == "ready" })
            ?? matches.first(where: { $0.state == "pending" || $0.state == "quarantined" })
    }

    private func apiJSON(
        path: String,
        method: String,
        body: [String: Any]? = nil,
        headers: [String: String] = [:]
    ) async throws -> Any {
        let token: String
        do {
            token = try await accessToken()
        } catch let failure as NativeOAuthError {
            if case let .requestFailed(retryable) = failure {
                throw NativeGatewayFailure(
                    code: "OAUTH_TOKEN_REFRESH_FAILED",
                    retryable: retryable
                )
            }
            throw NativeGatewayFailure(code: "OAUTH_SIGN_IN_REQUIRED", retryable: false)
        } catch is URLError {
            throw NativeGatewayFailure(code: "OAUTH_TOKEN_REFRESH_FAILED", retryable: true)
        } catch {
            throw NativeGatewayFailure(code: "OAUTH_SIGN_IN_REQUIRED", retryable: false)
        }
        guard !token.isEmpty, token.count <= 16_384, !token.contains("\n"), !token.contains("\r")
        else { throw NativeGatewayFailure(code: "OAUTH_TOKEN_INVALID", retryable: false) }
        var request = URLRequest(url: apiBase.appending(path: path))
        request.httpMethod = method
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        request.setValue("no-store", forHTTPHeaderField: "Cache-Control")
        for (name, value) in headers { request.setValue(value, forHTTPHeaderField: name) }
        if let body {
            request.httpBody = try JSONSerialization.data(withJSONObject: body)
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        }
        let (data, response): (Data, URLResponse)
        do {
            (data, response) = try await transport.data(for: request)
        } catch {
            throw NativeGatewayFailure(code: "ATRIUM_NETWORK_ERROR", retryable: true)
        }
        guard data.count <= 1_000_000,
              let http = response as? HTTPURLResponse
        else { throw Self.invalidResponse() }
        guard (200..<300).contains(http.statusCode) else {
            let json = try? JSONSerialization.jsonObject(with: data)
            let record = try? Self.record(json)
            let error = try? Self.record(record?["error"])
            let rawCode = Self.string(error?["code"], maximum: 100)
            let code = rawCode?.uppercased() ?? "ATRIUM_HTTP_\(http.statusCode)"
            let requestID = Self.string(record?["requestId"], maximum: 200)
                ?? http.value(forHTTPHeaderField: "X-Request-Id").flatMap {
                    $0.isEmpty || $0.count > 200 ? nil : $0
                }
            let retryable = http.statusCode == 408
                || http.statusCode == 429
                || http.statusCode >= 500
                || code == "IDEMPOTENCY_IN_PROGRESS"
            throw NativeGatewayFailure(
                code: code,
                requestID: requestID,
                retryable: retryable
            )
        }
        do {
            return try JSONSerialization.jsonObject(with: data)
        } catch {
            throw Self.invalidResponse()
        }
    }

    private static func asset(_ value: Any?) throws -> ContentAsset {
        let record = try Self.record(value)
        guard let filename = string(record["filename"], maximum: 255),
              let contentType = string(record["contentType"], maximum: 100),
              let byteLength = integer(record["byteLength"], maximum: 20 * 1_024 * 1_024),
              let sha256 = string(record["sha256"], maximum: 43),
              let purpose = string(record["purpose"], maximum: 32),
              let state = string(record["state"], maximum: 32),
              let width = integer(record["width"], maximum: 12_000),
              let height = integer(record["height"], maximum: 12_000),
              let expires = string(record["uploadExpiresAt"], maximum: 100),
              let uploadExpiresAt = parseDate(expires)
        else { throw invalidResponse() }
        return ContentAsset(
            id: try uuid(record["id"]),
            filename: filename,
            contentType: contentType,
            byteLength: byteLength,
            sha256: sha256,
            purpose: purpose,
            state: state,
            width: width,
            height: height,
            uploadExpiresAt: uploadExpiresAt
        )
    }

    private static func dataRecord(_ value: Any) throws -> [String: Any] {
        try record(try record(value)["data"])
    }

    private static func record(_ value: Any?) throws -> [String: Any] {
        guard let value = value as? [String: Any] else { throw invalidResponse() }
        return value
    }

    private static func string(_ value: Any?, maximum: Int) -> String? {
        guard let value = value as? String, !value.isEmpty, value.count <= maximum else {
            return nil
        }
        return value
    }

    private static func integer(_ value: Any?, maximum: Int) -> Int? {
        guard let value = value as? NSNumber,
              CFGetTypeID(value) != CFBooleanGetTypeID(),
              value.intValue > 0,
              value.intValue <= maximum
        else { return nil }
        return value.intValue
    }

    private static func uuid(_ value: Any?) throws -> String {
        guard let value = string(value, maximum: 36), let uuid = UUID(uuidString: value) else {
            throw invalidResponse()
        }
        return uuid.uuidString.lowercased()
    }

    private static func base64URLDigest(hex: String) throws -> String {
        guard hex.range(of: "^[0-9a-fA-F]{64}$", options: .regularExpression) != nil else {
            throw NativeGatewayFailure(code: "ASSET_SHA256_INVALID", retryable: false)
        }
        var bytes = Data()
        bytes.reserveCapacity(32)
        var index = hex.startIndex
        for _ in 0..<32 {
            let next = hex.index(index, offsetBy: 2)
            guard let byte = UInt8(hex[index..<next], radix: 16) else {
                throw NativeGatewayFailure(code: "ASSET_SHA256_INVALID", retryable: false)
            }
            bytes.append(byte)
            index = next
        }
        return bytes.base64EncodedString()
            .replacingOccurrences(of: "+", with: "-")
            .replacingOccurrences(of: "/", with: "_")
            .replacingOccurrences(of: "=", with: "")
    }

    private static func validUploadURL(_ value: String) throws -> URL {
        guard let url = URL(string: value),
              url.scheme == "https",
              url.user == nil,
              url.password == nil,
              let host = url.host,
              isS3UploadHost(host)
        else { throw NativeGatewayFailure(code: "ATRIUM_UPLOAD_URL_INVALID", retryable: false) }
        return url
    }

    private static func isS3UploadHost(_ value: String) -> Bool {
        let host = value.lowercased()
        let labels = host.split(separator: ".").map(String.init)
        let partitionLabels: Int
        if host.hasSuffix(".amazonaws.com.cn") {
            partitionLabels = 3
        } else if host.hasSuffix(".amazonaws.com") {
            partitionLabels = 2
        } else {
            return false
        }
        guard labels.count > partitionLabels else { return false }
        return labels.dropLast(partitionLabels).contains { label in
            guard label == "s3" || (label.hasPrefix("s3-") && label.count > 3) else {
                return false
            }
            return label.allSatisfy { $0.isASCII && ($0.isLetter || $0.isNumber || $0 == "-") }
        }
    }

    private static func invalidResponse() -> NativeGatewayFailure {
        NativeGatewayFailure(code: "ATRIUM_RESPONSE_INVALID", retryable: false)
    }

    private static func formatDate(_ date: Date) -> String {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return formatter.string(from: date)
    }

    private static func parseDate(_ value: String) -> Date? {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return formatter.date(from: value)
    }
}

private struct ContentAsset {
    let id: String
    let filename: String
    let contentType: String
    let byteLength: Int
    let sha256: String
    let purpose: String
    let state: String
    let width: Int
    let height: Int
    let uploadExpiresAt: Date
}

private struct InitiatedAsset {
    let asset: ContentAsset
    let uploadURL: String
    let contentTypeHeader: String
    let checksumHeader: String
    let sendChecksumHeader: Bool
}

private func firstNonempty(_ values: String?...) -> String? {
    values.lazy.compactMap { value in
        let trimmed = value?.trimmingCharacters(in: .whitespacesAndNewlines)
        return trimmed?.isEmpty == false ? trimmed : nil
    }.first
}
#endif
