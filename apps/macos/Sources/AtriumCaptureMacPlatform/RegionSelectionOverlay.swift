import AtriumCaptureCore
import Foundation

#if os(macOS)
import AppKit
import CoreGraphics

public enum RegionSelectionError: Error {
    case cancelled
    case noDisplays
    case previewUnavailable
}

@MainActor
public final class RegionSelectionController {
    private let capture: SerializedNativeCapture
    private var panels: [SelectionPanel] = []
    private var continuation: CheckedContinuation<NativeRect, Error>?

    public init(capture: SerializedNativeCapture) {
        self.capture = capture
    }

    public func selectRegion() async throws -> NativeRect {
        guard continuation == nil else { throw RegionSelectionError.cancelled }
        let displays = activeDisplays()
        guard !displays.isEmpty else { throw RegionSelectionError.noDisplays }

        var previews: [UInt32: NativeCapturedFrame] = [:]
        for display in displays {
            let center = NativeRect(
                x: display.frame.x + display.frame.width / 2,
                y: display.frame.y + display.frame.height / 2,
                width: 2,
                height: 2
            )
            if let frame = try? await capture.capture(
                request: NativeCaptureRequest(eventID: UUID().uuidString, bounds: center)
            ) {
                previews[display.id] = frame
            }
        }
        guard !previews.isEmpty else { throw RegionSelectionError.previewUnavailable }

        return try await withCheckedThrowingContinuation { continuation in
            self.continuation = continuation
            for display in displays {
                guard let preview = previews[display.id], let image = NSImage(data: preview.pngData) else { continue }
                let panel = SelectionPanel(
                    contentRect: appKitFrame(for: display.frame),
                    styleMask: .borderless,
                    backing: .buffered,
                    defer: false
                )
                panel.level = .screenSaver
                panel.backgroundColor = .clear
                panel.isOpaque = false
                panel.hasShadow = false
                panel.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary, .transient]
                let view = RegionSelectionView(
                    frame: NSRect(origin: .zero, size: panel.frame.size),
                    display: display,
                    preview: image,
                    onSelection: { [weak self] region in self?.finish(.success(region)) },
                    onCancel: { [weak self] in self?.finish(.failure(RegionSelectionError.cancelled)) }
                )
                panel.contentView = view
                panels.append(panel)
                panel.orderFrontRegardless()
            }
            guard !panels.isEmpty else {
                self.continuation = nil
                continuation.resume(throwing: RegionSelectionError.previewUnavailable)
                return
            }
            panels.first?.makeKey()
            panels.first?.makeFirstResponder(panels.first?.contentView)
        }
    }

    private func finish(_ result: Result<NativeRect, Error>) {
        panels.forEach { $0.orderOut(nil) }
        panels.removeAll()
        let continuation = self.continuation
        self.continuation = nil
        continuation?.resume(with: result)
    }

    private func activeDisplays() -> [NativeDisplay] {
        var count: UInt32 = 0
        guard CGGetActiveDisplayList(0, nil, &count) == .success else { return [] }
        var ids = [CGDirectDisplayID](repeating: 0, count: Int(count))
        guard CGGetActiveDisplayList(count, &ids, &count) == .success else { return [] }
        return ids.prefix(Int(count)).map { id in
            let bounds = CGDisplayBounds(id)
            return NativeDisplay(
                id: id,
                frame: NativeRect(x: bounds.minX, y: bounds.minY, width: bounds.width, height: bounds.height),
                pixelWidth: CGDisplayPixelsWide(id),
                pixelHeight: CGDisplayPixelsHigh(id)
            )
        }
    }

    private func appKitFrame(for quartz: NativeRect) -> NSRect {
        let mainHeight = CGDisplayBounds(CGMainDisplayID()).height
        return NSRect(
            x: quartz.x,
            y: mainHeight - quartz.y - quartz.height,
            width: quartz.width,
            height: quartz.height
        )
    }
}

private final class SelectionPanel: NSPanel {
    override var canBecomeKey: Bool { true }
}

@MainActor
private final class RegionSelectionView: NSView {
    private let display: NativeDisplay
    private let preview: NSImage
    private let bitmap: NSBitmapImageRep?
    private let onSelection: (NativeRect) -> Void
    private let onCancel: () -> Void
    private var start: NSPoint?
    private var current: NSPoint?
    private var hover = NSPoint.zero

    override var isFlipped: Bool { true }
    override var acceptsFirstResponder: Bool { true }

    init(
        frame: NSRect,
        display: NativeDisplay,
        preview: NSImage,
        onSelection: @escaping (NativeRect) -> Void,
        onCancel: @escaping () -> Void
    ) {
        self.display = display
        self.preview = preview
        bitmap = preview.cgImage(forProposedRect: nil, context: nil, hints: nil).map(NSBitmapImageRep.init(cgImage:))
        self.onSelection = onSelection
        self.onCancel = onCancel
        super.init(frame: frame)
        addTrackingArea(NSTrackingArea(
            rect: bounds,
            options: [.activeAlways, .mouseMoved, .inVisibleRect],
            owner: self,
            userInfo: nil
        ))
    }

    @available(*, unavailable)
    required init?(coder _: NSCoder) { nil }

    override func draw(_ dirtyRect: NSRect) {
        super.draw(dirtyRect)
        preview.draw(in: bounds, from: .zero, operation: .copy, fraction: 1, respectFlipped: true, hints: nil)
        NSColor.black.withAlphaComponent(0.38).setFill()
        bounds.fill()
        if let selectionRect {
            NSGraphicsContext.saveGraphicsState()
            NSBezierPath(rect: selectionRect).addClip()
            preview.draw(in: bounds, from: .zero, operation: .copy, fraction: 1, respectFlipped: true, hints: nil)
            NSGraphicsContext.restoreGraphicsState()
            NSColor.systemBlue.setStroke()
            let path = NSBezierPath(rect: selectionRect)
            path.lineWidth = 2
            path.stroke()
            drawSizeLabel(selectionRect)
        }
        drawMagnifier(at: hover)
    }

    override func mouseDown(with event: NSEvent) {
        let point = convert(event.locationInWindow, from: nil)
        start = point
        current = point
        hover = point
        needsDisplay = true
    }

    override func mouseDragged(with event: NSEvent) {
        current = convert(event.locationInWindow, from: nil)
        hover = current ?? .zero
        needsDisplay = true
    }

    override func mouseUp(with event: NSEvent) {
        current = convert(event.locationInWindow, from: nil)
        guard let rect = selectionRect, rect.width >= 2, rect.height >= 2 else {
            start = nil
            current = nil
            needsDisplay = true
            return
        }
        onSelection(NativeRect(
            x: display.frame.x + rect.minX,
            y: display.frame.y + rect.minY,
            width: rect.width,
            height: rect.height
        ))
    }

    override func mouseMoved(with event: NSEvent) {
        hover = convert(event.locationInWindow, from: nil)
        needsDisplay = true
    }

    override func keyDown(with event: NSEvent) {
        if event.keyCode == 53 { onCancel() }
        else { super.keyDown(with: event) }
    }

    private var selectionRect: NSRect? {
        guard let start, let current else { return nil }
        return NSRect(
            x: min(start.x, current.x),
            y: min(start.y, current.y),
            width: abs(current.x - start.x),
            height: abs(current.y - start.y)
        )
    }

    private func drawSizeLabel(_ rect: NSRect) {
        let text = "\(Int(rect.width)) × \(Int(rect.height)) pt"
        let attributes: [NSAttributedString.Key: Any] = [
            .font: NSFont.monospacedSystemFont(ofSize: 12, weight: .medium),
            .foregroundColor: NSColor.white,
            .backgroundColor: NSColor.black.withAlphaComponent(0.8),
        ]
        text.draw(at: NSPoint(x: rect.minX + 4, y: max(4, rect.minY - 20)), withAttributes: attributes)
    }

    private func drawMagnifier(at point: NSPoint) {
        guard bounds.contains(point) else { return }
        let size = NSSize(width: 132, height: 154)
        var origin = NSPoint(x: point.x + 18, y: point.y + 18)
        if origin.x + size.width > bounds.maxX { origin.x = point.x - size.width - 18 }
        if origin.y + size.height > bounds.maxY { origin.y = point.y - size.height - 18 }
        let box = NSRect(origin: origin, size: size)
        NSColor.black.withAlphaComponent(0.9).setFill()
        NSBezierPath(roundedRect: box, xRadius: 8, yRadius: 8).fill()

        let scaleX = preview.size.width / bounds.width
        let scaleY = preview.size.height / bounds.height
        let sample = NSRect(
            x: (point.x - 8) * scaleX,
            y: (point.y - 8) * scaleY,
            width: 16 * scaleX,
            height: 16 * scaleY
        )
        let destination = NSRect(x: box.minX + 6, y: box.minY + 6, width: 120, height: 120)
        preview.draw(in: destination, from: sample, operation: .copy, fraction: 1, respectFlipped: true, hints: [.interpolation: NSImageInterpolation.none])
        NSColor.white.setStroke()
        NSBezierPath(rect: destination).stroke()
        let color = sampledColor(at: point)
        let label = color.map(hex) ?? "#------"
        label.draw(
            at: NSPoint(x: box.minX + 8, y: box.maxY - 24),
            withAttributes: [
                .font: NSFont.monospacedSystemFont(ofSize: 12, weight: .semibold),
                .foregroundColor: NSColor.white,
            ]
        )
    }

    private func sampledColor(at point: NSPoint) -> NSColor? {
        guard let bitmap else { return nil }
        let x = min(max(Int(point.x / bounds.width * CGFloat(bitmap.pixelsWide)), 0), bitmap.pixelsWide - 1)
        let y = min(max(Int(point.y / bounds.height * CGFloat(bitmap.pixelsHigh)), 0), bitmap.pixelsHigh - 1)
        return bitmap.colorAt(x: x, y: y)
    }

    private func hex(_ color: NSColor) -> String {
        guard let rgb = color.usingColorSpace(.sRGB) else { return "#------" }
        return String(format: "#%02X%02X%02X", Int(rgb.redComponent * 255), Int(rgb.greenComponent * 255), Int(rgb.blueComponent * 255))
    }
}
#else
public final class RegionSelectionController {
    public init(capture _: SerializedNativeCapture) {}
}
#endif
