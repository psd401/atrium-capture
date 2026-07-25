import AtriumCaptureContracts
import AtriumCaptureMacPlatform
import Foundation
import XCTest

#if os(macOS)
import CoreGraphics
import ImageIO
import UniformTypeIdentifiers

final class RedactionGoldenTests: XCTestCase {
    func testOpaqueRedactionReplacesPixelsAndStripsMetadata() throws {
        let source = try sourcePNGWithMetadata(width: 10, height: 10)
        let redaction = AnnotationElement(
            arrowDirection: nil,
            color: "#000000",
            geometry: Geometry(height: 4, width: 4, x: 3, y: 3),
            id: "redaction-golden",
            kind: .redaction,
            text: nil
        )
        let flattened = try CoreGraphicsReviewRenderer.flatten(
            sourcePNG: source,
            crop: nil,
            annotations: [redaction]
        )
        let pixels = try rgbaPixels(flattened.pngData)

        // The 4x4 target is exactly opaque black in the exported bytes. Neighboring
        // pixels remain the synthetic source color, proving coordinates are bounded.
        XCTAssertEqual(pixel(pixels, width: 10, x: 4, y: 4), [0, 0, 0, 255])
        XCTAssertEqual(pixel(pixels, width: 10, x: 0, y: 0), [255, 0, 255, 255])

        let chunks = try pngChunkTypes(flattened.pngData)
        XCTAssertTrue(Set(["tEXt", "iTXt", "zTXt", "eXIf", "tIME"]).isDisjoint(with: chunks))
        XCTAssertFalse(String(decoding: flattened.pngData, as: UTF8.self).contains("Synthetic Author"))
    }

    func testEveryEditorToolChangesRenderedPixelsAndCropChangesDimensions() throws {
        let source = try checkerPNGWithMetadata(width: 80, height: 60)
        let baseline = try CoreGraphicsReviewRenderer.flatten(
            sourcePNG: source,
            crop: nil,
            annotations: []
        )
        let baselinePixels = try rgbaPixels(baseline.pngData)
        let kinds: [Kind] = [
            .redaction,
            .blur,
            .mosaic,
            .highlight,
            .rectangle,
            .arrow,
            .text,
        ]

        for kind in kinds {
            let rendered = try CoreGraphicsReviewRenderer.flatten(
                sourcePNG: source,
                crop: nil,
                annotations: [
                    AnnotationElement(
                        arrowDirection: kind == .arrow ? .downRight : nil,
                        color: kind == .redaction ? "#000000" : "#FFD400",
                        geometry: Geometry(height: 28, width: 36, x: 20, y: 14),
                        id: "synthetic-\(kind.rawValue)",
                        kind: kind,
                        text: kind == .text ? "Synthetic" : nil
                    ),
                ]
            )

            XCTAssertEqual(rendered.pixelWidth, 80, kind.rawValue)
            XCTAssertEqual(rendered.pixelHeight, 60, kind.rawValue)
            XCTAssertNotEqual(try rgbaPixels(rendered.pngData), baselinePixels, kind.rawValue)
            XCTAssertTrue(
                Set(["tEXt", "iTXt", "zTXt", "eXIf", "tIME"])
                    .isDisjoint(with: try pngChunkTypes(rendered.pngData)),
                kind.rawValue
            )
        }

        let cropped = try CoreGraphicsReviewRenderer.flatten(
            sourcePNG: source,
            crop: Geometry(height: 30, width: 40, x: 10, y: 10),
            annotations: []
        )
        XCTAssertEqual(cropped.pixelWidth, 40)
        XCTAssertEqual(cropped.pixelHeight, 30)
    }

    func testArrowRendererPreservesDirectionAndDefaultsLegacyArrowsUpRight() throws {
        let source = try checkerPNGWithMetadata(width: 80, height: 60)
        let directions: [ArrowDirection] = [.upRight, .downRight, .upLeft, .downLeft]
        let rendered = try directions.map { direction in
            try CoreGraphicsReviewRenderer.flatten(
                sourcePNG: source,
                crop: nil,
                annotations: [
                    AnnotationElement(
                        arrowDirection: direction,
                        color: "#FFD400",
                        geometry: Geometry(height: 32, width: 48, x: 16, y: 14),
                        id: "synthetic-\(direction.rawValue)",
                        kind: .arrow,
                        text: nil
                    ),
                ]
            ).pngData
        }
        XCTAssertEqual(Set(rendered).count, directions.count)

        let legacy = try CoreGraphicsReviewRenderer.flatten(
            sourcePNG: source,
            crop: nil,
            annotations: [
                AnnotationElement(
                    arrowDirection: nil,
                    color: "#FFD400",
                    geometry: Geometry(height: 32, width: 48, x: 16, y: 14),
                    id: "synthetic-legacy-arrow",
                    kind: .arrow,
                    text: nil
                ),
            ]
        )
        XCTAssertEqual(legacy.pngData, rendered[0])
    }

    private func sourcePNGWithMetadata(width: Int, height: Int) throws -> Data {
        let bytes = [UInt8](repeating: 255, count: width * height * 4).enumerated().map { index, value -> UInt8 in
            if index % 4 == 1 {
                return 0
            }
            return value
        }
        return try pngWithMetadata(bytes: bytes, width: width, height: height)
    }

    private func checkerPNGWithMetadata(width: Int, height: Int) throws -> Data {
        var bytes: [UInt8] = []
        bytes.reserveCapacity(width * height * 4)
        for y in 0..<height {
            for x in 0..<width {
                if (x / 2 + y / 2).isMultiple(of: 2) {
                    bytes.append(contentsOf: [255, 0, 255, 255])
                } else {
                    bytes.append(contentsOf: [0, 180, 110, 255])
                }
            }
        }
        return try pngWithMetadata(bytes: bytes, width: width, height: height)
    }

    private func pngWithMetadata(bytes: [UInt8], width: Int, height: Int) throws -> Data {
        let provider = try XCTUnwrap(CGDataProvider(data: Data(bytes) as CFData))
        let image = try XCTUnwrap(CGImage(
            width: width,
            height: height,
            bitsPerComponent: 8,
            bitsPerPixel: 32,
            bytesPerRow: width * 4,
            space: CGColorSpace(name: CGColorSpace.sRGB)!,
            bitmapInfo: CGBitmapInfo(rawValue: CGImageAlphaInfo.last.rawValue),
            provider: provider,
            decode: nil,
            shouldInterpolate: false,
            intent: .defaultIntent
        ))
        let data = NSMutableData()
        let destination = try XCTUnwrap(CGImageDestinationCreateWithData(
            data,
            UTType.png.identifier as CFString,
            1,
            nil
        ))
        CGImageDestinationAddImage(destination, image, [
            kCGImagePropertyTIFFDictionary: [kCGImagePropertyTIFFArtist: "Synthetic Author"],
        ] as CFDictionary)
        XCTAssertTrue(CGImageDestinationFinalize(destination))
        return data as Data
    }

    private func rgbaPixels(_ data: Data) throws -> [UInt8] {
        let source = try XCTUnwrap(CGImageSourceCreateWithData(data as CFData, nil))
        let image = try XCTUnwrap(CGImageSourceCreateImageAtIndex(source, 0, nil))
        var bytes = [UInt8](repeating: 0, count: image.width * image.height * 4)
        let context = try XCTUnwrap(CGContext(
            data: &bytes,
            width: image.width,
            height: image.height,
            bitsPerComponent: 8,
            bytesPerRow: image.width * 4,
            space: CGColorSpace(name: CGColorSpace.sRGB)!,
            bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue
        ))
        context.draw(image, in: CGRect(x: 0, y: 0, width: image.width, height: image.height))
        return bytes
    }

    private func pixel(_ pixels: [UInt8], width: Int, x: Int, y: Int) -> [UInt8] {
        let offset = (y * width + x) * 4
        return Array(pixels[offset..<(offset + 4)])
    }

    private func pngChunkTypes(_ data: Data) throws -> Set<String> {
        XCTAssertEqual(Array(data.prefix(8)), [137, 80, 78, 71, 13, 10, 26, 10])
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
}
#else
final class RedactionGoldenTests: XCTestCase {
    func testRendererIsCapabilityGatedOffMacOS() throws {
        XCTAssertThrowsError(try CoreGraphicsReviewRenderer.flatten(
            sourcePNG: Data([1]),
            crop: nil,
            annotations: []
        ))
    }
}
#endif
