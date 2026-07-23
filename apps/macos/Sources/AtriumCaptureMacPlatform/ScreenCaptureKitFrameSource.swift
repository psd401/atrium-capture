import AtriumCaptureCore
import Foundation

#if os(macOS)
import AppKit
import CoreGraphics
import ImageIO
import ScreenCaptureKit
import UniformTypeIdentifiers

public enum ScreenCaptureKitError: Error {
    case permissionRequired
    case noDisplay
    case encodingFailed
}

public final class ScreenCaptureKitFrameSource: NativeFrameSource, @unchecked Sendable {
    public init() {}

    public func capture(request: NativeCaptureRequest) async throws -> NativeCapturedFrame {
        guard CGPreflightScreenCaptureAccess() else { throw ScreenCaptureKitError.permissionRequired }
        let content = try await SCShareableContent.excludingDesktopWindows(false, onScreenWindowsOnly: true)
        guard let display = selectDisplay(content.displays, bounds: request.bounds) else {
            throw ScreenCaptureKitError.noDisplay
        }
        let ownBundleID = Bundle.main.bundleIdentifier
        let excluded = content.windows.filter { $0.owningApplication?.bundleIdentifier == ownBundleID }
        let filter = SCContentFilter(display: display, excludingWindows: excluded)
        let configuration = SCStreamConfiguration()
        if request.regionOnly, let bounds = request.bounds {
            let displayBounds = CGDisplayBounds(display.displayID)
            let local = CGRect(
                x: bounds.x - displayBounds.minX,
                y: bounds.y - displayBounds.minY,
                width: bounds.width,
                height: bounds.height
            ).intersection(CGRect(origin: .zero, size: displayBounds.size))
            guard !local.isNull, local.width >= 2, local.height >= 2 else {
                throw ScreenCaptureKitError.noDisplay
            }
            let scaleX = CGFloat(display.width) / displayBounds.width
            let scaleY = CGFloat(display.height) / displayBounds.height
            configuration.sourceRect = local
            configuration.width = max(1, Int((local.width * scaleX).rounded(.up)))
            configuration.height = max(1, Int((local.height * scaleY).rounded(.up)))
        } else {
            configuration.width = display.width
            configuration.height = display.height
        }
        configuration.showsCursor = false
        configuration.capturesAudio = false
        let image = try await SCScreenshotManager.captureImage(
            contentFilter: filter,
            configuration: configuration
        )
        let png = try metadataFreePNG(image)
        let scale = NSScreen.screens.first(where: {
            ($0.deviceDescription[NSDeviceDescriptionKey("NSScreenNumber")] as? CGDirectDisplayID) == display.displayID
        })?.backingScaleFactor ?? 1
        return NativeCapturedFrame(
            pngData: png,
            pixelWidth: image.width,
            pixelHeight: image.height,
            backingScaleFactor: scale
        )
    }

    private func selectDisplay(_ displays: [SCDisplay], bounds: NativeRect?) -> SCDisplay? {
        guard let bounds else { return displays.first(where: { $0.displayID == CGMainDisplayID() }) ?? displays.first }
        let center = CGPoint(x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2)
        return displays.first(where: { CGDisplayBounds($0.displayID).contains(center) })
            ?? displays.first(where: { $0.displayID == CGMainDisplayID() })
            ?? displays.first
    }

    private func metadataFreePNG(_ image: CGImage) throws -> Data {
        let output = NSMutableData()
        guard let destination = CGImageDestinationCreateWithData(
            output,
            UTType.png.identifier as CFString,
            1,
            nil
        ) else { throw ScreenCaptureKitError.encodingFailed }
        CGImageDestinationAddImage(destination, image, [:] as CFDictionary)
        guard CGImageDestinationFinalize(destination) else { throw ScreenCaptureKitError.encodingFailed }
        return output as Data
    }
}
#else
public enum ScreenCaptureKitError: Error { case unsupportedPlatform }

public final class ScreenCaptureKitFrameSource: NativeFrameSource, @unchecked Sendable {
    public init() {}
    public func capture(request _: NativeCaptureRequest) async throws -> NativeCapturedFrame {
        throw ScreenCaptureKitError.unsupportedPlatform
    }
}
#endif
