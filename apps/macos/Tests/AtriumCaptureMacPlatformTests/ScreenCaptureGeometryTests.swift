#if os(macOS)
import AtriumCaptureCore
@testable import AtriumCaptureMacPlatform
import CoreGraphics
import Testing

@Suite("Screen capture scope geometry")
struct ScreenCaptureGeometryTests {
    @Test("Region scope maps points to Retina pixels")
    func mapsRetinaRegion() throws {
        let plan = try #require(
            ScreenCaptureGeometry.regionPlan(
                bounds: NativeRect(x: 100, y: 50, width: 400, height: 300),
                displayBounds: CGRect(x: 0, y: 0, width: 1_440, height: 900),
                displayPixelWidth: 2_880,
                displayPixelHeight: 1_800
            )
        )

        #expect(plan.sourceRect == CGRect(x: 100, y: 50, width: 400, height: 300))
        #expect(plan.pixelWidth == 800)
        #expect(plan.pixelHeight == 600)
    }

    @Test("Region scope translates a secondary display origin")
    func translatesSecondaryDisplayOrigin() throws {
        let plan = try #require(
            ScreenCaptureGeometry.regionPlan(
                bounds: NativeRect(x: -1_800, y: 120, width: 600, height: 400),
                displayBounds: CGRect(x: -1_920, y: 0, width: 1_920, height: 1_080),
                displayPixelWidth: 1_920,
                displayPixelHeight: 1_080
            )
        )

        #expect(plan.sourceRect == CGRect(x: 120, y: 120, width: 600, height: 400))
        #expect(plan.pixelWidth == 600)
        #expect(plan.pixelHeight == 400)
    }

    @Test("Partially off-display regions are clipped before capture")
    func clipsPartialRegion() throws {
        let plan = try #require(
            ScreenCaptureGeometry.regionPlan(
                bounds: NativeRect(x: 1_800, y: 1_000, width: 300, height: 200),
                displayBounds: CGRect(x: 0, y: 0, width: 1_920, height: 1_080),
                displayPixelWidth: 3_840,
                displayPixelHeight: 2_160
            )
        )

        #expect(plan.sourceRect == CGRect(x: 1_800, y: 1_000, width: 120, height: 80))
        #expect(plan.pixelWidth == 240)
        #expect(plan.pixelHeight == 160)
    }

    @Test(
        "Invalid and fully off-display regions fail closed",
        arguments: [
            NativeRect(x: 2_000, y: 0, width: 100, height: 100),
            NativeRect(x: 0, y: 0, width: 0, height: 100),
            NativeRect(x: .nan, y: 0, width: 100, height: 100),
            NativeRect(x: -10, y: -10, width: 11, height: 11),
        ]
    )
    func rejectsInvalidRegion(region: NativeRect) {
        #expect(
            ScreenCaptureGeometry.regionPlan(
                bounds: region,
                displayBounds: CGRect(x: 0, y: 0, width: 1_920, height: 1_080),
                displayPixelWidth: 1_920,
                displayPixelHeight: 1_080
            ) == nil
        )
    }

    @Test("Fractional scaling rounds outward so edge pixels are not lost")
    func roundsFractionalPixelsOutward() throws {
        let plan = try #require(
            ScreenCaptureGeometry.regionPlan(
                bounds: NativeRect(x: 10, y: 10, width: 101, height: 51),
                displayBounds: CGRect(x: 0, y: 0, width: 1_500, height: 1_000),
                displayPixelWidth: 2_250,
                displayPixelHeight: 1_500
            )
        )

        #expect(plan.pixelWidth == 152)
        #expect(plan.pixelHeight == 77)
    }
}
#endif
