import AtriumCaptureCore
import Foundation

public enum NativePermissionState: String, Codable, Equatable, Sendable {
    case granted
    case denied
    case notDetermined
}

public struct NativePermissionSnapshot: Codable, Equatable, Sendable {
    public let screenRecording: NativePermissionState
    public let accessibility: NativePermissionState

    public init(screenRecording: NativePermissionState, accessibility: NativePermissionState) {
        self.screenRecording = screenRecording
        self.accessibility = accessibility
    }
}

#if os(macOS)
import AppKit
@preconcurrency import ApplicationServices
import CoreGraphics

public enum MacPrivacySettingsPane: Sendable {
    case accessibility
    case screenRecording
}

public enum MacPermissionRequest: String, Equatable, Sendable {
    case accessibility
    case screenRecording
}

public enum MacPermissionCenter {
    private static let accessibilityPromptKey =
        kAXTrustedCheckOptionPrompt.takeUnretainedValue() as String

    public static func snapshot() -> NativePermissionSnapshot {
        NativePermissionSnapshot(
            screenRecording: CGPreflightScreenCaptureAccess() ? .granted : .notDetermined,
            accessibility: AXIsProcessTrusted() ? .granted : .notDetermined
        )
    }

    @discardableResult
    public static func requestScreenRecording() -> Bool {
        CGRequestScreenCaptureAccess()
    }

    @discardableResult
    public static func requestAccessibilityPrompt() -> Bool {
        let options = [accessibilityPromptKey: true] as CFDictionary
        return AXIsProcessTrustedWithOptions(options)
    }

    public static func nextRequest(for snapshot: NativePermissionSnapshot) -> MacPermissionRequest? {
        if snapshot.screenRecording != .granted {
            return .screenRecording
        }
        if snapshot.accessibility != .granted {
            return .accessibility
        }
        return nil
    }

    @discardableResult
    public static func requestNextMissing() -> MacPermissionRequest? {
        guard let request = nextRequest(for: snapshot()) else { return nil }
        switch request {
        case .screenRecording:
            _ = requestScreenRecording()
        case .accessibility:
            _ = requestAccessibilityPrompt()
        }
        return request
    }

    public static func openSettings(_ pane: MacPrivacySettingsPane) {
        let anchor = switch pane {
        case .accessibility:
            "Privacy_Accessibility"
        case .screenRecording:
            "Privacy_ScreenCapture"
        }
        guard let url = URL(
            string: "x-apple.systempreferences:com.apple.preference.security?\(anchor)"
        ) else { return }
        NSWorkspace.shared.open(url)
    }
}

public final class AccessibilitySemanticReader: @unchecked Sendable {
    public init() {}

    /// Reads roles, labels, geometry, and application context only. It deliberately
    /// never requests `kAXValueAttribute`, selected text, or keystroke content.
    public func focusedEvent(action: NativeCaptureAction, occurredAt: Date = Date()) -> NativeSemanticEvent? {
        guard AXIsProcessTrusted(),
              let app = NSWorkspace.shared.frontmostApplication,
              app.bundleIdentifier != Bundle.main.bundleIdentifier
        else { return nil }

        let applicationElement = AXUIElementCreateApplication(app.processIdentifier)
        guard let focusedValue = attribute(applicationElement, kAXFocusedUIElementAttribute as CFString),
              CFGetTypeID(focusedValue) == AXUIElementGetTypeID()
        else {
            return nil
        }
        let focused = focusedValue as! AXUIElement
        let role = attribute(focused, kAXRoleAttribute as CFString) as? String

        // Secure fields are represented only by their role so the core can reject
        // the event before any screenshot is requested.
        let secure = (role ?? "").localizedCaseInsensitiveContains("secure")
        let name: String? = secure ? nil : (
            attribute(focused, kAXTitleAttribute as CFString) as? String
                ?? attribute(focused, kAXDescriptionAttribute as CFString) as? String
                ?? attribute(focused, kAXHelpAttribute as CFString) as? String
        )
        let windowValue = attribute(focused, kAXWindowAttribute as CFString)
        let window: AXUIElement? = if let windowValue, CFGetTypeID(windowValue) == AXUIElementGetTypeID() {
            (windowValue as! AXUIElement)
        } else {
            nil
        }
        let windowTitle = window.flatMap { attribute($0, kAXTitleAttribute as CFString) as? String }
        let position = axPoint(attribute(focused, kAXPositionAttribute as CFString))
        let size = axSize(attribute(focused, kAXSizeAttribute as CFString))
        let bounds: NativeRect? = if let position, let size {
            NativeRect(x: position.x, y: position.y, width: size.width, height: size.height)
        } else {
            nil
        }
        let scale = NSScreen.screens.first(where: { screen in
            guard let bounds else { return false }
            return screen.frame.intersects(NSRect(x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height))
        })?.backingScaleFactor ?? NSScreen.main?.backingScaleFactor ?? 1

        return NativeSemanticEvent(
            eventID: UUID().uuidString.lowercased(),
            occurredAt: occurredAt,
            action: action,
            accessibilityRole: role,
            accessibleName: name,
            bounds: bounds,
            appName: app.localizedName ?? "Application",
            bundleID: app.bundleIdentifier ?? "unknown.application",
            windowTitle: windowTitle,
            backingScaleFactor: scale
        )
    }

    private func attribute(_ element: AXUIElement, _ key: CFString) -> CFTypeRef? {
        var value: CFTypeRef?
        guard AXUIElementCopyAttributeValue(element, key, &value) == .success else { return nil }
        return value
    }

    private func axPoint(_ value: CFTypeRef?) -> CGPoint? {
        guard let value, CFGetTypeID(value) == AXValueGetTypeID() else { return nil }
        var point = CGPoint.zero
        guard AXValueGetValue(value as! AXValue, .cgPoint, &point) else { return nil }
        return point
    }

    private func axSize(_ value: CFTypeRef?) -> CGSize? {
        guard let value, CFGetTypeID(value) == AXValueGetTypeID() else { return nil }
        var size = CGSize.zero
        guard AXValueGetValue(value as! AXValue, .cgSize, &size) else { return nil }
        return size
    }
}
#else
public enum MacPermissionCenter {
    public static func snapshot() -> NativePermissionSnapshot {
        NativePermissionSnapshot(screenRecording: .denied, accessibility: .denied)
    }
}

public final class AccessibilitySemanticReader: @unchecked Sendable {
    public init() {}
    public func focusedEvent(action _: NativeCaptureAction, occurredAt _: Date = Date()) -> NativeSemanticEvent? { nil }
}
#endif
