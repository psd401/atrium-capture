#if os(macOS)
import XCTest
@testable import AtriumCaptureMacPlatform

final class MacPermissionCenterTests: XCTestCase {
    func testSnapshotMapsGrantedAndMissingProbeResults() {
        let cases: [(screenRecording: Bool, accessibility: Bool, expected: NativePermissionSnapshot)] = [
            (false, false, NativePermissionSnapshot(screenRecording: .notDetermined, accessibility: .notDetermined)),
            (false, true, NativePermissionSnapshot(screenRecording: .notDetermined, accessibility: .granted)),
            (true, false, NativePermissionSnapshot(screenRecording: .granted, accessibility: .notDetermined)),
            (true, true, NativePermissionSnapshot(screenRecording: .granted, accessibility: .granted)),
        ]

        for testCase in cases {
            var screenRecordingProbeCalls = 0
            var accessibilityProbeCalls = 0

            let snapshot = MacPermissionCenter.snapshot(
                screenRecordingProbe: {
                    screenRecordingProbeCalls += 1
                    return testCase.screenRecording
                },
                accessibilityProbe: {
                    accessibilityProbeCalls += 1
                    return testCase.accessibility
                }
            )

            XCTAssertEqual(snapshot, testCase.expected)
            XCTAssertEqual(screenRecordingProbeCalls, 1)
            XCTAssertEqual(accessibilityProbeCalls, 1)
        }
    }

    func testSnapshotRechecksLivePermissionProbesAfterGrant() {
        var screenRecordingGranted = false
        var accessibilityGranted = false
        let snapshot = {
            MacPermissionCenter.snapshot(
                screenRecordingProbe: { screenRecordingGranted },
                accessibilityProbe: { accessibilityGranted }
            )
        }

        XCTAssertEqual(
            snapshot(),
            NativePermissionSnapshot(
                screenRecording: .notDetermined,
                accessibility: .notDetermined
            )
        )

        screenRecordingGranted = true
        accessibilityGranted = true

        XCTAssertEqual(
            snapshot(),
            NativePermissionSnapshot(screenRecording: .granted, accessibility: .granted)
        )
    }

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

    func testDeniedPermissionsRemainRequestableInRequiredOrder() {
        XCTAssertEqual(
            MacPermissionCenter.nextRequest(
                for: NativePermissionSnapshot(
                    screenRecording: .denied,
                    accessibility: .granted
                )
            ),
            .screenRecording
        )
        XCTAssertEqual(
            MacPermissionCenter.nextRequest(
                for: NativePermissionSnapshot(
                    screenRecording: .granted,
                    accessibility: .denied
                )
            ),
            .accessibility
        )
    }

    func testReadinessTransitionsReflectBothLiveGrants() {
        let missing = NativePermissionSnapshot(
            screenRecording: .notDetermined,
            accessibility: .notDetermined
        )
        let partial = NativePermissionSnapshot(
            screenRecording: .granted,
            accessibility: .notDetermined
        )
        let ready = NativePermissionSnapshot(
            screenRecording: .granted,
            accessibility: .granted
        )

        XCTAssertFalse(MacPermissionCenter.becameReady(from: missing, to: partial))
        XCTAssertTrue(MacPermissionCenter.becameReady(from: partial, to: ready))
        XCTAssertFalse(MacPermissionCenter.becameReady(from: ready, to: ready))
        XCTAssertFalse(MacPermissionCenter.lostReadiness(from: missing, to: partial))
        XCTAssertTrue(MacPermissionCenter.lostReadiness(from: ready, to: partial))
        XCTAssertTrue(MacPermissionCenter.lostReadiness(from: ready, to: missing))
        XCTAssertFalse(MacPermissionCenter.lostReadiness(from: ready, to: ready))
    }
}
#endif
