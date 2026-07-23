import AtriumCaptureContracts
import AtriumCaptureCore
import Foundation

#if os(macOS)
import AppKit

public actor MacCapturePipeline {
    private let recorder: NativeRecorder
    private let reader: AccessibilitySemanticReader
    private let capture: SerializedNativeCapture
    private let vault: NativeAssetVault

    public init(
        recorder: NativeRecorder,
        reader: AccessibilitySemanticReader,
        capture: SerializedNativeCapture,
        vault: NativeAssetVault
    ) {
        self.recorder = recorder
        self.reader = reader
        self.capture = capture
        self.vault = vault
    }

    public func handle(_ action: NativeCaptureAction) async {
        guard let session = recorder.snapshot(), session.state == .recording,
              let event = reader.focusedEvent(action: action)
        else { return }
        if event.isSensitiveField {
            _ = try? recorder.record(event)
            return
        }
        var pendingAsset: NativeCapturedAsset?
        do {
            let frame = try await capture.capture(
                request: NativeCaptureRequest(eventID: event.eventID, bounds: event.bounds)
            )
            let asset = try vault.writeRaw(frame: frame, sessionID: session.sessionID)
            pendingAsset = asset
            let decision = try recorder.record(event, screenshot: asset)
            if case .recorded = decision {
                pendingAsset = nil
            } else {
                try? vault.delete(localKey: asset.localKey)
                pendingAsset = nil
            }
        } catch {
            if let pendingAsset { try? vault.delete(localKey: pendingAsset.localKey) }
            // Error details are intentionally not logged: framework errors can carry
            // window titles. The UI obtains only a fixed diagnostic code.
        }
    }
}

@MainActor
public final class MacEventMonitor {
    private var monitors: [Any] = []
    private let pipeline: MacCapturePipeline

    public init(pipeline: MacCapturePipeline) {
        self.pipeline = pipeline
    }

    public func start() {
        guard monitors.isEmpty else { return }
        if let mouse = NSEvent.addGlobalMonitorForEvents(
            matching: [.leftMouseDown, .rightMouseDown],
            handler: { [pipeline] _ in Task { await pipeline.handle(.click) } }
        ) {
            monitors.append(mouse)
        }
        if let keyboard = NSEvent.addGlobalMonitorForEvents(
            matching: [.keyDown],
            handler: { [pipeline] event in
                let action: NativeCaptureAction = event.modifierFlags
                    .intersection([.command, .control, .option]).isEmpty ? .input : .shortcut
                Task { await pipeline.handle(action) }
            }
        ) {
            monitors.append(keyboard)
        }
        if let scroll = NSEvent.addGlobalMonitorForEvents(
            matching: [.scrollWheel],
            handler: { [pipeline] _ in Task { await pipeline.handle(.scroll) } }
        ) {
            monitors.append(scroll)
        }
    }

    public func stop() {
        monitors.forEach(NSEvent.removeMonitor)
        monitors.removeAll()
    }

}
#else
public actor MacCapturePipeline {}
public final class MacEventMonitor {
    public init() {}
}
#endif
