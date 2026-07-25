#if os(macOS)
import XCTest
@testable import AtriumCaptureMacPlatform

final class MacPermissionCenterTests: XCTestCase {
    func testRequestsPermissionsSequentiallySoPromptsCannotSupersedeEachOther() {
        XCTAssertEqual(
            MacPermissionCenter.nextRequest(
                for: NativePermissionSnapshot(
                    screenRecording: .notDetermined,
                    accessibility: .notDetermined
                )
            ),
            .screenRecording
        )
        XCTAssertEqual(
            MacPermissionCenter.nextRequest(
                for: NativePermissionSnapshot(
                    screenRecording: .granted,
                    accessibility: .notDetermined
                )
            ),
            .accessibility
        )
        XCTAssertNil(
            MacPermissionCenter.nextRequest(
                for: NativePermissionSnapshot(
                    screenRecording: .granted,
                    accessibility: .granted
                )
            )
        )
    }
}
#endif
