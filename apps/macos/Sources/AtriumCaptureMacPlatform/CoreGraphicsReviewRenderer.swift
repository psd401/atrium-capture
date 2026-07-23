import AtriumCaptureContracts
import AtriumCaptureCore
import Foundation

public struct FlattenedNativeImage: Equatable, Sendable {
    public let pngData: Data
    public let pixelWidth: Int
    public let pixelHeight: Int

    public init(pngData: Data, pixelWidth: Int, pixelHeight: Int) {
        self.pngData = pngData
        self.pixelWidth = pixelWidth
        self.pixelHeight = pixelHeight
    }
}

#if os(macOS)
import AppKit
import CoreImage
import CoreGraphics
import ImageIO
import UniformTypeIdentifiers

public enum NativeRenderError: Error {
    case invalidSource
    case invalidCrop
    case contextCreationFailed
    case encodingFailed
}

public enum CoreGraphicsReviewRenderer {
    public static func flatten(
        sourcePNG: Data,
        crop: Geometry?,
        annotations: [AnnotationElement]
    ) throws -> FlattenedNativeImage {
        guard let imageSource = CGImageSourceCreateWithData(sourcePNG as CFData, nil),
              let source = CGImageSourceCreateImageAtIndex(imageSource, 0, nil)
        else { throw NativeRenderError.invalidSource }

        let cropped: CGImage
        let cropGeometry: Geometry
        if let crop {
            let rect = CGRect(x: crop.x, y: crop.y, width: crop.width, height: crop.height).integral
            guard rect.minX >= 0,
                  rect.minY >= 0,
                  rect.maxX <= CGFloat(source.width),
                  rect.maxY <= CGFloat(source.height),
                  let result = source.cropping(to: rect)
            else { throw NativeRenderError.invalidCrop }
            cropped = result
            cropGeometry = crop
        } else {
            cropped = source
            cropGeometry = Geometry(
                height: Double(source.height),
                width: Double(source.width),
                x: 0,
                y: 0
            )
        }

        let width = cropped.width
        let height = cropped.height
        guard let colorSpace = CGColorSpace(name: CGColorSpace.sRGB),
              let context = CGContext(
                  data: nil,
                  width: width,
                  height: height,
                  bitsPerComponent: 8,
                  bytesPerRow: 0,
                  space: colorSpace,
                  bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue
              )
        else { throw NativeRenderError.contextCreationFailed }

        context.interpolationQuality = .high
        context.draw(cropped, in: CGRect(x: 0, y: 0, width: width, height: height))
        let transform: (AnnotationElement) -> AnnotationElement = { annotation in
            annotation.with(geometry: Geometry(
                height: annotation.geometry.height * (Double(height) / cropGeometry.height),
                width: annotation.geometry.width * (Double(width) / cropGeometry.width),
                x: (annotation.geometry.x - cropGeometry.x) * (Double(width) / cropGeometry.width),
                y: (annotation.geometry.y - cropGeometry.y) * (Double(height) / cropGeometry.height)
            ))
        }
        for annotation in annotations where annotation.kind != .redaction {
            draw(transform(annotation), in: context, imageHeight: CGFloat(height))
        }

        // Privacy redactions are deliberately last, opaque, and use copy blending.
        // This replaces the destination pixels rather than retaining recoverable alpha.
        context.saveGState()
        context.setBlendMode(.copy)
        context.setFillColor(NSColor.black.cgColor)
        for annotation in annotations where annotation.kind == .redaction {
            context.fill(renderRect(transform(annotation).geometry, imageHeight: CGFloat(height)))
        }
        context.restoreGState()

        guard let outputImage = context.makeImage() else { throw NativeRenderError.contextCreationFailed }
        let output = NSMutableData()
        guard let destination = CGImageDestinationCreateWithData(
            output,
            UTType.png.identifier as CFString,
            1,
            nil
        ) else { throw NativeRenderError.encodingFailed }
        CGImageDestinationAddImage(destination, outputImage, [:] as CFDictionary)
        guard CGImageDestinationFinalize(destination) else { throw NativeRenderError.encodingFailed }
        return FlattenedNativeImage(
            pngData: try stripPNGMetadata(output as Data),
            pixelWidth: width,
            pixelHeight: height
        )
    }

    private static func draw(_ annotation: AnnotationElement, in context: CGContext, imageHeight: CGFloat) {
        let rect = renderRect(annotation.geometry, imageHeight: imageHeight)
        let color = parseColor(annotation.color) ?? NSColor.systemYellow
        context.saveGState()
        switch annotation.kind {
        case .highlight:
            context.setFillColor(color.withAlphaComponent(0.28).cgColor)
            context.fill(rect)
        case .rectangle:
            context.setStrokeColor(color.cgColor)
            context.setLineWidth(3)
            context.stroke(rect)
        case .arrow:
            let start = CGPoint(x: rect.minX, y: rect.minY)
            let end = CGPoint(x: rect.maxX, y: rect.maxY)
            context.setStrokeColor(color.cgColor)
            context.setFillColor(color.cgColor)
            context.setLineWidth(4)
            context.move(to: start)
            context.addLine(to: end)
            context.strokePath()
            let angle = atan2(end.y - start.y, end.x - start.x)
            let head: CGFloat = 13
            context.move(to: end)
            context.addLine(to: CGPoint(
                x: end.x - head * cos(angle - .pi / 6),
                y: end.y - head * sin(angle - .pi / 6)
            ))
            context.addLine(to: CGPoint(
                x: end.x - head * cos(angle + .pi / 6),
                y: end.y - head * sin(angle + .pi / 6)
            ))
            context.closePath()
            context.fillPath()
        case .text:
            let graphics = NSGraphicsContext(cgContext: context, flipped: false)
            NSGraphicsContext.saveGraphicsState()
            NSGraphicsContext.current = graphics
            let text = String((annotation.text ?? "Text").prefix(300))
            text.draw(
                in: rect,
                withAttributes: [
                    .font: NSFont.systemFont(ofSize: 18, weight: .semibold),
                    .foregroundColor: color,
                    .backgroundColor: NSColor.black.withAlphaComponent(0.72),
                ]
            )
            NSGraphicsContext.restoreGraphicsState()
        case .blur, .mosaic:
            if let current = context.makeImage() {
                let input = CIImage(cgImage: current)
                let output: CIImage
                if annotation.kind == .blur {
                    output = input.clampedToExtent().applyingGaussianBlur(sigma: 8).cropped(to: input.extent)
                } else {
                    output = input.applyingFilter("CIPixellate", parameters: [
                        kCIInputScaleKey: 12,
                        kCIInputCenterKey: CIVector(x: rect.midX, y: rect.midY),
                    ])
                }
                let ciContext = CIContext(options: [.cacheIntermediates: false])
                if let filtered = ciContext.createCGImage(output, from: rect) {
                    context.draw(filtered, in: rect)
                }
            }
        case .redaction:
            break
        }
        context.restoreGState()
    }

    private static func renderRect(_ geometry: Geometry, imageHeight: CGFloat) -> CGRect {
        CGRect(
            x: geometry.x,
            y: imageHeight - geometry.y - geometry.height,
            width: geometry.width,
            height: geometry.height
        ).integral
    }

    private static func parseColor(_ value: String?) -> NSColor? {
        guard var value else { return nil }
        value = value.trimmingCharacters(in: CharacterSet(charactersIn: "#"))
        guard value.count == 6, let raw = UInt64(value, radix: 16) else { return nil }
        return NSColor(
            red: CGFloat((raw >> 16) & 0xff) / 255,
            green: CGFloat((raw >> 8) & 0xff) / 255,
            blue: CGFloat(raw & 0xff) / 255,
            alpha: 1
        )
    }

    private static func stripPNGMetadata(_ data: Data) throws -> Data {
        let signature: [UInt8] = [137, 80, 78, 71, 13, 10, 26, 10]
        guard data.count >= 8, Array(data.prefix(8)) == signature else {
            throw NativeRenderError.encodingFailed
        }
        let forbidden: Set<String> = ["tEXt", "iTXt", "zTXt", "eXIf", "tIME"]
        var result = Data(signature)
        var offset = 8
        var foundEnd = false
        while offset + 12 <= data.count {
            let length = data[offset..<(offset + 4)].reduce(UInt32(0)) { ($0 << 8) | UInt32($1) }
            let chunkLength = 12 + Int(length)
            guard chunkLength >= 12, offset + chunkLength <= data.count else {
                throw NativeRenderError.encodingFailed
            }
            let typeStart = offset + 4
            let type = String(decoding: data[typeStart..<(typeStart + 4)], as: UTF8.self)
            if !forbidden.contains(type) {
                result.append(data[offset..<(offset + chunkLength)])
            }
            offset += chunkLength
            if type == "IEND" {
                foundEnd = true
                break
            }
        }
        guard foundEnd else { throw NativeRenderError.encodingFailed }
        return result
    }
}
#else
public enum NativeRenderError: Error { case unsupportedPlatform }

public enum CoreGraphicsReviewRenderer {
    public static func flatten(
        sourcePNG _: Data,
        crop _: Geometry?,
        annotations _: [AnnotationElement]
    ) throws -> FlattenedNativeImage {
        throw NativeRenderError.unsupportedPlatform
    }
}
#endif
