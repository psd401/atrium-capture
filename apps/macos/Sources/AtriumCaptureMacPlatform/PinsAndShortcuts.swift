import AtriumCaptureCore
import Foundation

#if os(macOS)
import AppKit
import CoreGraphics

public struct PinnedWindowVerificationState: Equatable, Sendable {
    public let floating: Bool
    public let clickThrough: Bool
    public let joinsAllSpaces: Bool
    public let fullScreenAuxiliary: Bool

    public init(
        floating: Bool,
        clickThrough: Bool,
        joinsAllSpaces: Bool,
        fullScreenAuxiliary: Bool
    ) {
        self.floating = floating
        self.clickThrough = clickThrough
        self.joinsAllSpaces = joinsAllSpaces
        self.fullScreenAuxiliary = fullScreenAuxiliary
    }
}

@MainActor
public final class MacClipboardController {
    private var clearTask: Task<Void, Never>?

    public init() {}

    public func copyPNG(_ data: Data, retention: ClipboardRetention) {
        clearTask?.cancel()
        guard retention != .doNotCopy else { return }
        let pasteboard = NSPasteboard.general
        pasteboard.clearContents()
        pasteboard.setData(data, forType: .png)
        let changeCount = pasteboard.changeCount
        guard case let .clearAfterSeconds(seconds) = retention else { return }
        clearTask = Task { @MainActor in
            try? await Task.sleep(for: .seconds(seconds))
            guard !Task.isCancelled, NSPasteboard.general.changeCount == changeCount else { return }
            NSPasteboard.general.clearContents()
        }
    }
}

@MainActor
public final class PinnedImageWindowManager: NSObject, NSWindowDelegate {
    public var onFrameChange: ((String, NativeRect, UInt32) -> Void)?
    private var windows: [String: NSPanel] = [:]
    private var pinIDsByWindow: [ObjectIdentifier: String] = [:]
    private var visible = true

    public override init() { super.init() }

    public func show(pin: PinnedCapture, pngData: Data) {
        guard let image = NSImage(data: pngData) else { return }
        let panel = windows[pin.id] ?? NSPanel(
            contentRect: appKitFrame(pin.frame),
            styleMask: [.titled, .closable, .resizable, .nonactivatingPanel],
            backing: .buffered,
            defer: false
        )
        panel.title = pin.title
        panel.level = .floating
        panel.isFloatingPanel = true
        panel.hidesOnDeactivate = false
        panel.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary, .transient]
        panel.ignoresMouseEvents = pin.clickThrough
        panel.isMovableByWindowBackground = true
        panel.delegate = self
        panel.contentAspectRatio = image.size
        let view = NSImageView(frame: panel.contentView?.bounds ?? .zero)
        view.image = image
        view.imageScaling = .scaleProportionallyUpOrDown
        view.autoresizingMask = [.width, .height]
        panel.contentView = view
        windows[pin.id] = panel
        pinIDsByWindow[ObjectIdentifier(panel)] = pin.id
        visible = true
        panel.orderFrontRegardless()
    }

    public func setClickThrough(pinID: String, enabled: Bool) {
        windows[pinID]?.ignoresMouseEvents = enabled
    }

    public func close(pinID: String) {
        if let panel = windows.removeValue(forKey: pinID) {
            pinIDsByWindow.removeValue(forKey: ObjectIdentifier(panel))
            panel.close()
        }
    }

    public func closeAll() {
        windows.values.forEach { $0.close() }
        windows.removeAll()
        pinIDsByWindow.removeAll()
    }

    public func toggleVisibility() {
        visible.toggle()
        windows.values.forEach { window in
            if visible { window.orderFrontRegardless() }
            else { window.orderOut(nil) }
        }
    }

    public func verificationState(pinID: String) -> PinnedWindowVerificationState? {
        guard let window = windows[pinID] else { return nil }
        return PinnedWindowVerificationState(
            floating: window.level == .floating,
            clickThrough: window.ignoresMouseEvents,
            joinsAllSpaces: window.collectionBehavior.contains(.canJoinAllSpaces),
            fullScreenAuxiliary: window.collectionBehavior.contains(.fullScreenAuxiliary)
        )
    }

    public func windowDidMove(_ notification: Notification) {
        reportFrameChange(notification)
    }

    public func windowDidEndLiveResize(_ notification: Notification) {
        reportFrameChange(notification)
    }

    private func reportFrameChange(_ notification: Notification) {
        guard let panel = notification.object as? NSPanel,
              let pinID = pinIDsByWindow[ObjectIdentifier(panel)]
        else { return }
        let frame = quartzFrame(panel.frame)
        var displayID: CGDirectDisplayID = 0
        var count: UInt32 = 0
        let center = CGPoint(x: frame.x + frame.width / 2, y: frame.y + frame.height / 2)
        _ = CGGetDisplaysWithPoint(center, 1, &displayID, &count)
        onFrameChange?(pinID, frame, count > 0 ? displayID : CGMainDisplayID())
    }

    private func appKitFrame(_ quartz: NativeRect) -> NSRect {
        let mainHeight = CGDisplayBounds(CGMainDisplayID()).height
        return NSRect(
            x: quartz.x,
            y: mainHeight - quartz.y - quartz.height,
            width: quartz.width,
            height: quartz.height
        )
    }

    private func quartzFrame(_ appKit: NSRect) -> NativeRect {
        let mainHeight = CGDisplayBounds(CGMainDisplayID()).height
        return NativeRect(
            x: appKit.minX,
            y: mainHeight - appKit.maxY,
            width: appKit.width,
            height: appKit.height
        )
    }
}

@MainActor
public final class GlobalCaptureShortcuts {
    public var captureRegion: (() -> Void)?
    public var captureElement: (() -> Void)?
    public var togglePins: (() -> Void)?
    private var globalMonitor: Any?
    private var localMonitor: Any?

    public init() {}

    public func start() {
        guard globalMonitor == nil, localMonitor == nil else { return }
        globalMonitor = NSEvent.addGlobalMonitorForEvents(matching: .keyDown) { [weak self] event in
            Task { @MainActor in self?.handle(event) }
        }
        localMonitor = NSEvent.addLocalMonitorForEvents(matching: .keyDown) { [weak self] event in
            guard self?.handle(event) == true else { return event }
            return nil
        }
    }

    public func stop() {
        if let globalMonitor { NSEvent.removeMonitor(globalMonitor) }
        if let localMonitor { NSEvent.removeMonitor(localMonitor) }
        globalMonitor = nil
        localMonitor = nil
    }

    @discardableResult
    private func handle(_ event: NSEvent) -> Bool {
        let required: NSEvent.ModifierFlags = [.command, .option]
        guard event.modifierFlags.intersection(.deviceIndependentFlagsMask).contains(required) else {
            return false
        }
        switch event.charactersIgnoringModifiers?.lowercased() {
        case "a": captureRegion?(); return true
        case "e": captureElement?(); return true
        case "p": togglePins?(); return true
        default: return false
        }
    }

}
#else
public final class MacClipboardController { public init() {} }
public final class PinnedImageWindowManager { public init() {} }
public final class GlobalCaptureShortcuts { public init() {} }
#endif
