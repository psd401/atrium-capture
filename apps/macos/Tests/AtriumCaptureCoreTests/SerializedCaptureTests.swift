import Foundation
import XCTest
@testable import AtriumCaptureCore

private actor SyntheticFrameSource: NativeFrameSource {
    private var active = 0
    private var maximumActive = 0

    func capture(request _: NativeCaptureRequest) async throws -> NativeCapturedFrame {
        active += 1
        maximumActive = max(maximumActive, active)
        try await Task.sleep(for: .milliseconds(10))
        active -= 1
        return NativeCapturedFrame(
            pngData: Data([1]),
            pixelWidth: 1,
            pixelHeight: 1,
            backingScaleFactor: 1
        )
    }

    func maxActive() -> Int { maximumActive }
}

final class SerializedCaptureTests: XCTestCase {
    func testCaptureRequestsAreSerialized() async throws {
        let source = SyntheticFrameSource()
        let capture = SerializedNativeCapture(source: source)
        try await withThrowingTaskGroup(of: Void.self) { group in
            for index in 0..<8 {
                group.addTask {
                    _ = try await capture.capture(
                        request: NativeCaptureRequest(eventID: "event-\(index)", bounds: nil)
                    )
                }
            }
            try await group.waitForAll()
        }
        let maximumActive = await source.maxActive()
        XCTAssertEqual(maximumActive, 1)
    }
}
