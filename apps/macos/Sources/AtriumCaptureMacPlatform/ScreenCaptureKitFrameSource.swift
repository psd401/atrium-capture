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

public enum MacRecordingCaptureScope: @unchecked Sendable {
    case automatic
    case contentFilter(SCContentFilter)
    case region(NativeRect)
}

struct ScreenCaptureRegionPlan: Equatable {
    let sourceRect: CGRect
    let pixelWidth: Int
    let pixelHeight: Int
}

enum ScreenCaptureGeometry {
    static func regionPlan(
        bounds: NativeRect,
        displayBounds: CGRect,
        displayPixelWidth: Int,
        displayPixelHeight: Int
    ) -> ScreenCaptureRegionPlan? {
        guard bounds.isValid,
              displayBounds.width > 0,
              displayBounds.height > 0,
              displayPixelWidth > 0,
              displayPixelHeight > 0
        else { return nil }
        let local = CGRect(
            x: bounds.x - displayBounds.minX,
            y: bounds.y - displayBounds.minY,
            width: bounds.width,
            height: bounds.height
        ).intersection(CGRect(origin: .zero, size: displayBounds.size))
        guard !local.isNull, local.width >= 2, local.height >= 2 else { return nil }
        let scaleX = CGFloat(displayPixelWidth) / displayBounds.width
        let scaleY = CGFloat(displayPixelHeight) / displayBounds.height
        return ScreenCaptureRegionPlan(
            sourceRect: local,
            pixelWidth: max(1, Int((local.width * scaleX).rounded(.up))),
            pixelHeight: max(1, Int((local.height * scaleY).rounded(.up)))
        )
    }
}

public final class ScreenCaptureKitFrameSource: NativeFrameSource, @unchecked Sendable {
    private let scopeLock = NSLock()
    private var recordingScope: MacRecordingCaptureScope = .automatic

    public init() {}

    public func setRecordingScope(_ scope: MacRecordingCaptureScope) {
        scopeLock.lock()
        recordingScope = scope
        scopeLock.unlock()
    }

    /// Resolves an exact synthetic fixture window for signed local acceptance.
    /// The production UI uses `SCContentSharingPicker` instead.
    public func syntheticWindowScope(
        exactWindowTitle: String
    ) async throws -> MacRecordingCaptureScope {
        guard !exactWindowTitle.isEmpty, exactWindowTitle.count <= 500 else {
            throw ScreenCaptureKitError.noDisplay
        }
        let content = try await SCShareableContent.excludingDesktopWindows(
            false,
            onScreenWindowsOnly: true
        )
        guard let window = content.windows.first(where: {
            $0.title == exactWindowTitle
        }) else {
            throw ScreenCaptureKitError.noDisplay
        }
        return .contentFilter(SCContentFilter(desktopIndependentWindow: window))
    }

    public func capture(request: NativeCaptureRequest) async throws -> NativeCapturedFrame {
        guard CGPreflightScreenCaptureAccess() else { throw ScreenCaptureKitError.permissionRequired }
        let scope = request.usesRecordingScope ? currentRecordingScope() : .automatic
        if case let .contentFilter(filter) = scope {
            let information = SCShareableContent.info(for: filter)
            let configuration = SCStreamConfiguration()
            configuration.width = max(
                1,
                Int((information.contentRect.width * CGFloat(information.pointPixelScale)).rounded(.up))
            )
            configuration.height = max(
                1,
                Int((information.contentRect.height * CGFloat(information.pointPixelScale)).rounded(.up))
            )
            return try await captureFrame(
                filter: filter,
                configuration: configuration,
                scale: Double(information.pointPixelScale)
            )
        }

        let content = try await SCShareableContent.excludingDesktopWindows(false, onScreenWindowsOnly: true)
        let captureBounds: NativeRect? = switch scope {
        case .automatic:
            request.bounds
        case let .region(region):
            region
        case .contentFilter:
            nil
        }
        guard let display = selectDisplay(content.displays, bounds: captureBounds) else {
            throw ScreenCaptureKitError.noDisplay
        }
        let ownBundleID = Bundle.main.bundleIdentifier
        let excluded = content.windows.filter { $0.owningApplication?.bundleIdentifier == ownBundleID }
        let filter = SCContentFilter(display: display, excludingWindows: excluded)
        let configuration = SCStreamConfiguration()
        let fixedRegion: NativeRect? = if case let .region(region) = scope { region } else { nil }
        if let bounds = fixedRegion ?? (request.regionOnly ? request.bounds : nil) {
            let displayBounds = CGDisplayBounds(display.displayID)
            guard let plan = ScreenCaptureGeometry.regionPlan(
                bounds: bounds,
                displayBounds: displayBounds,
                displayPixelWidth: display.width,
                displayPixelHeight: display.height
            ) else {
                throw ScreenCaptureKitError.noDisplay
            }
            configuration.sourceRect = plan.sourceRect
            configuration.width = plan.pixelWidth
            configuration.height = plan.pixelHeight
        } else {
            configuration.width = display.width
            configuration.height = display.height
        }
        configuration.showsCursor = false
        configuration.capturesAudio = false
        let scale = NSScreen.screens.first(where: {
            ($0.deviceDescription[NSDeviceDescriptionKey("NSScreenNumber")] as? CGDirectDisplayID) == display.displayID
        })?.backingScaleFactor ?? 1
        return try await captureFrame(
            filter: filter,
            configuration: configuration,
            scale: scale
        )
    }

    private func currentRecordingScope() -> MacRecordingCaptureScope {
        scopeLock.lock()
        defer { scopeLock.unlock() }
        return recordingScope
    }

    private func captureFrame(
        filter: SCContentFilter,
        configuration: SCStreamConfiguration,
        scale: Double
    ) async throws -> NativeCapturedFrame {
        configuration.showsCursor = false
        configuration.capturesAudio = false
        let image = try await SCScreenshotManager.captureImage(
            contentFilter: filter,
            configuration: configuration
        )
        return NativeCapturedFrame(
            pngData: try metadataFreePNG(image),
            pixelWidth: image.width,
            pixelHeight: image.height,
            backingScaleFactor: max(1, scale)
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
public enum MacRecordingCaptureScope: Sendable { case automatic, region(NativeRect) }

public final class ScreenCaptureKitFrameSource: NativeFrameSource, @unchecked Sendable {
    public init() {}
    public func setRecordingScope(_: MacRecordingCaptureScope) {}
    public func capture(request _: NativeCaptureRequest) async throws -> NativeCapturedFrame {
        throw ScreenCaptureKitError.unsupportedPlatform
    }
}
#endif
