import Foundation

#if os(macOS)
@preconcurrency import ScreenCaptureKit

public enum RecordingScopePickerMode: Sendable {
    case display
    case window
}

public enum RecordingScopePickerError: Error {
    case alreadyActive
    case cancelled
    case unavailable
}

@MainActor
public final class RecordingScopePicker: NSObject, SCContentSharingPickerObserver {
    private var continuation: CheckedContinuation<MacRecordingCaptureScope, Error>?
    private let picker = SCContentSharingPicker.shared

    public override init() {
        super.init()
    }

    public func select(_ mode: RecordingScopePickerMode) async throws -> MacRecordingCaptureScope {
        guard continuation == nil else { throw RecordingScopePickerError.alreadyActive }
        var configuration = SCContentSharingPickerConfiguration()
        configuration.allowedPickerModes = mode == .display ? .singleDisplay : .singleWindow
        configuration.allowsChangingSelectedContent = false
        if let ownBundleID = Bundle.main.bundleIdentifier {
            configuration.excludedBundleIDs = [ownBundleID]
        }
        picker.defaultConfiguration = configuration
        picker.add(self)
        picker.isActive = true

        return try await withCheckedThrowingContinuation { continuation in
            self.continuation = continuation
            picker.present(using: mode == .display ? .display : .window)
        }
    }

    public nonisolated func contentSharingPicker(
        _ picker: SCContentSharingPicker,
        didCancelFor stream: SCStream?
    ) {
        Task { @MainActor [weak self] in
            self?.finish(.failure(RecordingScopePickerError.cancelled))
        }
    }

    public nonisolated func contentSharingPicker(
        _ picker: SCContentSharingPicker,
        didUpdateWith filter: SCContentFilter,
        for stream: SCStream?
    ) {
        Task { @MainActor [weak self] in
            self?.finish(.success(.contentFilter(filter)))
        }
    }

    public nonisolated func contentSharingPickerStartDidFailWithError(_ error: any Error) {
        Task { @MainActor [weak self] in
            self?.finish(.failure(RecordingScopePickerError.unavailable))
        }
    }

    private func finish(_ result: Result<MacRecordingCaptureScope, Error>) {
        picker.remove(self)
        picker.isActive = false
        let continuation = self.continuation
        self.continuation = nil
        continuation?.resume(with: result)
    }
}
#else
public enum RecordingScopePickerMode: Sendable { case display, window }
public enum RecordingScopePickerError: Error { case unavailable }
public final class RecordingScopePicker {
    public init() {}
    public func select(_: RecordingScopePickerMode) async throws -> MacRecordingCaptureScope {
        throw RecordingScopePickerError.unavailable
    }
}
#endif
