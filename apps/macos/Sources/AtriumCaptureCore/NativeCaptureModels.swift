import AtriumCaptureContracts
import Foundation

public struct NativePoint: Codable, Equatable, Sendable {
    public let x: Double
    public let y: Double

    public init(x: Double, y: Double) {
        self.x = x
        self.y = y
    }
}

public struct NativeRect: Codable, Equatable, Sendable {
    public let x: Double
    public let y: Double
    public let width: Double
    public let height: Double

    public init(x: Double, y: Double, width: Double, height: Double) {
        self.x = x
        self.y = y
        self.width = width
        self.height = height
    }

    public var isValid: Bool {
        x.isFinite && y.isFinite && width.isFinite && height.isFinite && width > 0 && height > 0
    }

    public var contractGeometry: Geometry {
        Geometry(height: height, width: width, x: x, y: y)
    }
}

public enum NativeCaptureAction: String, Codable, Sendable {
    case click
    case drag
    case input
    case manual
    case navigate
    case scroll
    case select
    case shortcut
    case submit

    var contractAction: Action {
        switch self {
        case .click: .click
        case .drag: .drag
        case .input: .input
        case .manual: .manual
        case .navigate: .navigate
        case .scroll: .scroll
        case .select: .select
        case .shortcut: .shortcut
        case .submit: .submit
        }
    }
}

/// Semantic data collected without reading an accessibility element's value.
/// The macOS adapter never requests `kAXValueAttribute`.
public struct NativeSemanticEvent: Codable, Equatable, Sendable {
    public let eventID: String
    public let occurredAt: Date
    public let action: NativeCaptureAction
    public let accessibilityRole: String?
    public let accessibleName: String?
    public let bounds: NativeRect?
    public let appName: String
    public let bundleID: String
    public let windowTitle: String?
    public let backingScaleFactor: Double

    public init(
        eventID: String,
        occurredAt: Date,
        action: NativeCaptureAction,
        accessibilityRole: String?,
        accessibleName: String?,
        bounds: NativeRect?,
        appName: String,
        bundleID: String,
        windowTitle: String?,
        backingScaleFactor: Double
    ) {
        self.eventID = eventID
        self.occurredAt = occurredAt
        self.action = action
        self.accessibilityRole = accessibilityRole
        self.accessibleName = accessibleName
        self.bounds = bounds
        self.appName = appName
        self.bundleID = bundleID
        self.windowTitle = windowTitle
        self.backingScaleFactor = backingScaleFactor
    }

    public var isSensitiveField: Bool {
        let role = (accessibilityRole ?? "").lowercased()
        return role.contains("secure") || role.contains("password")
    }
}

public struct NativeCapturedAsset: Codable, Equatable, Sendable {
    public let assetID: String
    public let localKey: String
    public let sha256: String
    public let pixelWidth: Int
    public let pixelHeight: Int

    public init(assetID: String, localKey: String, sha256: String, pixelWidth: Int, pixelHeight: Int) {
        self.assetID = assetID
        self.localKey = localKey
        self.sha256 = sha256
        self.pixelWidth = pixelWidth
        self.pixelHeight = pixelHeight
    }
}

public struct NativeCaptureRequest: Equatable, Sendable {
    public let eventID: String
    public let bounds: NativeRect?
    public let regionOnly: Bool

    public init(eventID: String, bounds: NativeRect?, regionOnly: Bool = false) {
        self.eventID = eventID
        self.bounds = bounds
        self.regionOnly = regionOnly
    }
}

public struct NativeCapturedFrame: Equatable, Sendable {
    public let pngData: Data
    public let pixelWidth: Int
    public let pixelHeight: Int
    public let backingScaleFactor: Double

    public init(pngData: Data, pixelWidth: Int, pixelHeight: Int, backingScaleFactor: Double) {
        self.pngData = pngData
        self.pixelWidth = pixelWidth
        self.pixelHeight = pixelHeight
        self.backingScaleFactor = backingScaleFactor
    }
}

public protocol NativeFrameSource: Sendable {
    func capture(request: NativeCaptureRequest) async throws -> NativeCapturedFrame
}

/// Actor isolation guarantees that ScreenCaptureKit is never asked for overlapping frames.
public actor SerializedNativeCapture {
    private let source: any NativeFrameSource
    private var tail: Task<Void, Never>?

    public init(source: any NativeFrameSource) {
        self.source = source
    }

    public func capture(request: NativeCaptureRequest) async throws -> NativeCapturedFrame {
        let previous = tail
        let source = self.source
        let operation = Task {
            if let previous { await previous.value }
            return try await source.capture(request: request)
        }
        tail = Task { _ = await operation.result }
        return try await operation.value
    }
}
