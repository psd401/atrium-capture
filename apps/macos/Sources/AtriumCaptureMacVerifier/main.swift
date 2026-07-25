import AtriumCaptureContracts
import AtriumCaptureCore
import AtriumCaptureMacPlatform
import Foundation

#if os(macOS)
import CoreGraphics
import ImageIO
import UniformTypeIdentifiers

private enum VerificationFailure: Error {
    case imageCreation
    case encoding
    case decoding
    case redactionPixel
    case neighborPixel
    case metadata
    case productionGateway
}

@main
enum AtriumCaptureMacVerifier {
    @MainActor
    static func main() async throws {
        let source = try sourcePNGWithMetadata(width: 10, height: 10)
        let flattened = try CoreGraphicsReviewRenderer.flatten(
            sourcePNG: source,
            crop: nil,
            annotations: [AnnotationElement(
                arrowDirection: nil,
                color: "#000000",
                geometry: Geometry(height: 4, width: 4, x: 3, y: 3),
                id: "synthetic-redaction",
                kind: .redaction,
                text: nil
            )]
        )
        let pixels = try rgbaPixels(flattened.pngData)
        guard pixel(pixels, width: 10, x: 4, y: 4) == [0, 0, 0, 255] else {
            throw VerificationFailure.redactionPixel
        }
        guard pixel(pixels, width: 10, x: 0, y: 0) == [255, 0, 255, 255] else {
            throw VerificationFailure.neighborPixel
        }
        let chunks = try pngChunkTypes(flattened.pngData)
        guard Set(["tEXt", "iTXt", "zTXt", "eXIf", "tIME"]).isDisjoint(with: chunks),
              !String(decoding: flattened.pngData, as: UTF8.self).contains("Synthetic Author")
        else { throw VerificationFailure.metadata }
        try verifyPinnedWindow(pngData: flattened.pngData)
        try await verifyProductionGatewayContract()
        print("native-verifier: redaction, metadata, pin, and production gateway checks passed")
    }

    private static func sourcePNGWithMetadata(width: Int, height: Int) throws -> Data {
        let bytes = [UInt8](repeating: 255, count: width * height * 4).enumerated().map { index, value in
            index % 4 == 1 ? 0 : value
        }
        guard let provider = CGDataProvider(data: Data(bytes) as CFData),
              let colorSpace = CGColorSpace(name: CGColorSpace.sRGB),
              let image = CGImage(
                  width: width,
                  height: height,
                  bitsPerComponent: 8,
                  bitsPerPixel: 32,
                  bytesPerRow: width * 4,
                  space: colorSpace,
                  bitmapInfo: CGBitmapInfo(rawValue: CGImageAlphaInfo.last.rawValue),
                  provider: provider,
                  decode: nil,
                  shouldInterpolate: false,
                  intent: .defaultIntent
              )
        else { throw VerificationFailure.imageCreation }
        let data = NSMutableData()
        guard let destination = CGImageDestinationCreateWithData(
            data,
            UTType.png.identifier as CFString,
            1,
            nil
        ) else { throw VerificationFailure.encoding }
        CGImageDestinationAddImage(destination, image, [
            kCGImagePropertyTIFFDictionary: [kCGImagePropertyTIFFArtist: "Synthetic Author"],
        ] as CFDictionary)
        guard CGImageDestinationFinalize(destination) else { throw VerificationFailure.encoding }
        return data as Data
    }

    private static func rgbaPixels(_ data: Data) throws -> [UInt8] {
        guard let source = CGImageSourceCreateWithData(data as CFData, nil),
              let image = CGImageSourceCreateImageAtIndex(source, 0, nil),
              let colorSpace = CGColorSpace(name: CGColorSpace.sRGB)
        else { throw VerificationFailure.decoding }
        var bytes = [UInt8](repeating: 0, count: image.width * image.height * 4)
        guard let context = CGContext(
            data: &bytes,
            width: image.width,
            height: image.height,
            bitsPerComponent: 8,
            bytesPerRow: image.width * 4,
            space: colorSpace,
            bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue
        ) else { throw VerificationFailure.decoding }
        context.draw(image, in: CGRect(x: 0, y: 0, width: image.width, height: image.height))
        return bytes
    }

    private static func pixel(_ pixels: [UInt8], width: Int, x: Int, y: Int) -> [UInt8] {
        let offset = (y * width + x) * 4
        return Array(pixels[offset..<(offset + 4)])
    }

    private static func pngChunkTypes(_ data: Data) throws -> Set<String> {
        guard data.count >= 8, Array(data.prefix(8)) == [137, 80, 78, 71, 13, 10, 26, 10] else {
            throw VerificationFailure.decoding
        }
        var offset = 8
        var result: Set<String> = []
        while offset + 12 <= data.count {
            let length = data[offset..<(offset + 4)].reduce(UInt32(0)) { ($0 << 8) | UInt32($1) }
            let typeStart = offset + 4
            let type = String(decoding: data[typeStart..<(typeStart + 4)], as: UTF8.self)
            result.insert(type)
            offset += 12 + Int(length)
            if type == "IEND" { break }
        }
        return result
    }

    @MainActor
    private static func verifyPinnedWindow(pngData: Data) throws {
        let pin = PinnedCapture(
            id: "synthetic-pin-verifier",
            localKey: "synthetic/pin.png",
            title: "Synthetic pin",
            frame: NativeRect(x: 20, y: 20, width: 160, height: 120),
            displayID: CGMainDisplayID(),
            clickThrough: true,
            groupID: "synthetic",
            createdAt: Date(timeIntervalSince1970: 1_000),
            byteCount: pngData.count
        )
        let manager = PinnedImageWindowManager()
        manager.show(pin: pin, pngData: pngData)
        guard manager.verificationState(pinID: pin.id) == PinnedWindowVerificationState(
            floating: true,
            clickThrough: true,
            joinsAllSpaces: true,
            fullScreenAuxiliary: true
        ) else { throw VerificationFailure.imageCreation }
        manager.closeAll()
    }

    private static func verifyProductionGatewayContract() async throws {
        let transport = VerifierAtriumTransport()
        let gateway = try ProductionNativeAtriumGateway(transport: transport) {
            "synthetic-access-token"
        }
        let draft = try await gateway.createPrivateDraft(
            title: "Synthetic native guide",
            sourceRef: NativeCaptureSourceRef(
                capturedAt: Date(timeIntervalSince1970: 1_753_387_200),
                clientVersion: "1.0.0",
                externalID: verifierSessionID
            ),
            collectionID: verifierCollectionID,
            idempotencyKey: "object:synthetic-job"
        )
        let asset = try await gateway.uploadPublishableAsset(
            objectID: draft.objectID,
            localAssetID: verifierLocalAssetID,
            pngData: verifierAssetData,
            pixelWidth: 1280,
            pixelHeight: 720,
            sha256: verifierAssetDigestHex,
            idempotencyKey: "asset:synthetic-job"
        )
        let version = try await gateway.createVersion(
            objectID: draft.objectID,
            markdown: "# Synthetic\n\n" + (try gateway.formatAssetMarkdown(
                remoteAssetID: asset.assetID,
                altText: "Reviewed"
            )),
            idempotencyKey: "version:synthetic-job"
        )
        try await gateway.publishInternal(
            objectID: draft.objectID,
            versionID: version.versionID,
            idempotencyKey: "publish:synthetic-job"
        )

        let requests = await transport.requests
        guard let create = requests.first(where: {
            $0.url?.path == "/api/v1/content" && $0.httpMethod == "POST"
        }),
        let createBody = try JSONSerialization.jsonObject(
            with: create.httpBody ?? Data()
        ) as? [String: Any],
        (createBody["visibility"] as? [String: String])?["level"] == "private",
        createBody["body"] == nil,
        (createBody["sourceRef"] as? [String: Any])?["clientSurface"] as? String == "mac",
        create.value(forHTTPHeaderField: "Idempotency-Key") == "object:synthetic-job",
        let initiate = requests.first(where: {
            $0.url?.path.hasSuffix("/assets") == true && $0.httpMethod == "POST"
        }),
        initiate.value(forHTTPHeaderField: "Idempotency-Key") == "asset:synthetic-job",
        let upload = requests.first(where: { $0.url?.host?.contains("amazonaws.com") == true }),
        upload.value(forHTTPHeaderField: "Authorization") == nil,
        Set(upload.allHTTPHeaderFields?.keys.map { $0.lowercased() } ?? [])
            == Set(["content-type"]),
        let versionRequest = requests.first(where: { $0.url?.path.hasSuffix("/versions") == true }),
        versionRequest.value(forHTTPHeaderField: "If-Match") == "\"none\"",
        let publishRequest = requests.first(where: { $0.url?.path.hasSuffix("/publish") == true }),
        publishRequest.value(forHTTPHeaderField: "If-Match") == "\"\(verifierVersionID)\"",
        version.readerURL == "https://aistudio.psd401.ai/atrium/\(verifierObjectID)/edit"
        else { throw VerificationFailure.productionGateway }
    }
}

private actor VerifierAtriumTransport: NativeHTTPTransport {
    private(set) var requests: [URLRequest] = []

    func data(for request: URLRequest) async throws -> (Data, URLResponse) {
        requests.append(request)
        guard let url = request.url else { throw VerificationFailure.productionGateway }
        if url.host?.contains("amazonaws.com") == true {
            return response(url: url, status: 200, body: nil)
        }
        switch (request.httpMethod ?? "GET", url.path) {
        case ("POST", "/api/v1/content"):
            return response(url: url, status: 201, body: [
                "data": [
                    "id": verifierObjectID,
                    "slug": "synthetic-native-guide",
                    "visibilityLevel": "private",
                    "currentVersionId": NSNull(),
                ],
            ])
        case ("GET", "/api/v1/content/\(verifierObjectID)/assets"):
            return response(url: url, status: 200, body: ["data": []])
        case ("POST", "/api/v1/content/\(verifierObjectID)/assets"):
            return response(url: url, status: 201, body: [
                "data": assetRecord(state: "pending").merging([
                    "upload": [
                        "method": "PUT",
                        "url": verifierHoistedUploadURL,
                        "headers": [
                            "content-type": "image/png",
                            "x-amz-checksum-sha256": verifierAssetDigestBase64,
                        ],
                        "expiresAt": "2030-07-24T20:15:00.000Z",
                    ],
                ]) { _, new in new },
            ])
        case ("POST", "/api/v1/content/\(verifierObjectID)/assets/\(verifierAssetID)/complete"):
            return response(url: url, status: 200, body: ["data": assetRecord(state: "ready")])
        case ("POST", "/api/v1/content/\(verifierObjectID)/versions"):
            return response(url: url, status: 201, body: [
                "data": [
                    "currentVersionId": verifierVersionID,
                    "slug": "synthetic-native-guide",
                    "version": ["id": verifierVersionID],
                ],
            ])
        case ("POST", "/api/v1/content/\(verifierObjectID)/publish"):
            return response(url: url, status: 200, body: [
                "data": [
                    "id": verifierObjectID,
                    "destination": "intranet",
                    "publishedVersionId": verifierVersionID,
                ],
            ])
        default:
            throw VerificationFailure.productionGateway
        }
    }

    private func response(
        url: URL,
        status: Int,
        body: [String: Any]?
    ) -> (Data, URLResponse) {
        let data = body.map { try! JSONSerialization.data(withJSONObject: $0) } ?? Data()
        return (
            data,
            HTTPURLResponse(
                url: url,
                statusCode: status,
                httpVersion: "HTTP/1.1",
                headerFields: ["Content-Type": "application/json"]
            )!
        )
    }

    private func assetRecord(state: String) -> [String: Any] {
        [
            "id": verifierAssetID,
            "objectId": verifierObjectID,
            "filename": "atrium-capture-\(verifierLocalAssetID).png",
            "contentType": "image/png",
            "byteLength": verifierAssetData.count,
            "sha256": verifierAssetDigestBase64URL,
            "purpose": "capture_step",
            "state": state,
            "width": 1280,
            "height": 720,
            "uploadExpiresAt": "2030-07-24T20:15:00.000Z",
        ]
    }
}

private let verifierCollectionID = "60000000-0000-4000-8000-000000000001"
private let verifierSessionID = "10000000-0000-4000-8000-000000000001"
private let verifierObjectID = "a1000000-0000-4000-8000-000000000001"
private let verifierLocalAssetID = "a3000000-0000-4000-8000-000000000001"
private let verifierAssetID = "a2000000-0000-4000-8000-000000000001"
private let verifierVersionID = "a4000000-0000-4000-8000-000000000001"
private let verifierHoistedUploadURL =
    "https://synthetic-bucket.s3.us-west-2.amazonaws.com/upload"
        + "?X-Amz-Checksum-Sha256=k3UW6sWEhEdP%2B3ulJIlxs2euQtJYwhvGpFRIDtvMWe8%3D"
        + "&X-Amz-SignedHeaders=content-length%3Bhost&X-Amz-Signature=fake"
private let verifierAssetData = Data("synthetic-reviewed-image".utf8)
private let verifierAssetDigestHex =
    "937516eac58484474ffb7ba5248971b367ae42d258c21bc6a454480edbcc59ef"
private let verifierAssetDigestBase64 = "k3UW6sWEhEdP+3ulJIlxs2euQtJYwhvGpFRIDtvMWe8="
private let verifierAssetDigestBase64URL = "k3UW6sWEhEdP-3ulJIlxs2euQtJYwhvGpFRIDtvMWe8"
#else
@main
enum AtriumCaptureMacVerifier {
    static func main() {
        print("native-verifier: macOS framework checks require macOS")
    }
}
#endif
