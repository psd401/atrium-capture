import Foundation

public struct NativeDisplay: Codable, Equatable, Sendable {
    public let id: UInt32
    /// Quartz global coordinates in points, with the primary display origin at top-left.
    public let frame: NativeRect
    public let pixelWidth: Int
    public let pixelHeight: Int

    public init(id: UInt32, frame: NativeRect, pixelWidth: Int, pixelHeight: Int) {
        self.id = id
        self.frame = frame
        self.pixelWidth = pixelWidth
        self.pixelHeight = pixelHeight
    }

    public var scaleX: Double { Double(pixelWidth) / frame.width }
    public var scaleY: Double { Double(pixelHeight) / frame.height }
}

public struct NativePixelRect: Codable, Equatable, Sendable {
    public let x: Int
    public let y: Int
    public let width: Int
    public let height: Int

    public init(x: Int, y: Int, width: Int, height: Int) {
        self.x = x
        self.y = y
        self.width = width
        self.height = height
    }
}

public enum DisplayGeometryError: Error, Equatable {
    case noDisplay
    case regionOutsideDisplay
}

public enum DisplayGeometry {
    public static func display(containing point: NativePoint, displays: [NativeDisplay]) -> NativeDisplay? {
        displays.first { display in
            point.x >= display.frame.x
                && point.x < display.frame.x + display.frame.width
                && point.y >= display.frame.y
                && point.y < display.frame.y + display.frame.height
        }
    }

    public static func display(containing region: NativeRect, displays: [NativeDisplay]) -> NativeDisplay? {
        let center = NativePoint(x: region.x + region.width / 2, y: region.y + region.height / 2)
        return display(containing: center, displays: displays)
    }

    public static func pixelRect(for region: NativeRect, on display: NativeDisplay) throws -> NativePixelRect {
        guard region.isValid else { throw DisplayGeometryError.regionOutsideDisplay }
        let left = max(region.x, display.frame.x)
        let top = max(region.y, display.frame.y)
        let right = min(region.x + region.width, display.frame.x + display.frame.width)
        let bottom = min(region.y + region.height, display.frame.y + display.frame.height)
        guard right > left, bottom > top else { throw DisplayGeometryError.regionOutsideDisplay }
        return NativePixelRect(
            x: Int(((left - display.frame.x) * display.scaleX).rounded(.down)),
            y: Int(((top - display.frame.y) * display.scaleY).rounded(.down)),
            width: Int(((right - left) * display.scaleX).rounded(.up)),
            height: Int(((bottom - top) * display.scaleY).rounded(.up))
        )
    }

    public static func normalizedSelection(from start: NativePoint, to end: NativePoint, minimum: Double = 2) -> NativeRect? {
        let rect = NativeRect(
            x: min(start.x, end.x),
            y: min(start.y, end.y),
            width: abs(end.x - start.x),
            height: abs(end.y - start.y)
        )
        return rect.width >= minimum && rect.height >= minimum ? rect : nil
    }
}

public struct NativeColorSample: Codable, Equatable, Sendable {
    public let red: UInt8
    public let green: UInt8
    public let blue: UInt8
    public let alpha: UInt8

    public init(red: UInt8, green: UInt8, blue: UInt8, alpha: UInt8) {
        self.red = red
        self.green = green
        self.blue = blue
        self.alpha = alpha
    }

    public var hexRGB: String { String(format: "#%02X%02X%02X", red, green, blue) }
}

public enum PixelSampler {
    public static func rgba(
        data: Data,
        width: Int,
        height: Int,
        bytesPerRow: Int,
        x: Int,
        y: Int
    ) -> NativeColorSample? {
        guard width > 0, height > 0,
              x >= 0, y >= 0, x < width, y < height,
              bytesPerRow >= width * 4
        else { return nil }
        let offset = y * bytesPerRow + x * 4
        guard offset >= 0, offset + 3 < data.count else { return nil }
        return NativeColorSample(
            red: data[offset],
            green: data[offset + 1],
            blue: data[offset + 2],
            alpha: data[offset + 3]
        )
    }
}
