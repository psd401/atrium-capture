import AtriumCaptureContracts
import AtriumCaptureCore
import XCTest

final class NativeAnnotationPlacementTests: XCTestCase {
    func testPreservesEveryArrowDragDirection() {
        let origin = NativePoint(x: 50, y: 50)

        XCTAssertEqual(
            NativeAnnotationPlacement.arrowDirection(
                from: origin,
                to: NativePoint(x: 100, y: 10)
            )?.rawValue,
            ArrowDirection.upRight.rawValue
        )
        XCTAssertEqual(
            NativeAnnotationPlacement.arrowDirection(
                from: origin,
                to: NativePoint(x: 100, y: 90)
            )?.rawValue,
            ArrowDirection.downRight.rawValue
        )
        XCTAssertEqual(
            NativeAnnotationPlacement.arrowDirection(
                from: origin,
                to: NativePoint(x: 10, y: 10)
            )?.rawValue,
            ArrowDirection.upLeft.rawValue
        )
        XCTAssertEqual(
            NativeAnnotationPlacement.arrowDirection(
                from: origin,
                to: NativePoint(x: 10, y: 90)
            )?.rawValue,
            ArrowDirection.downLeft.rawValue
        )
    }

    func testMapsForwardAndReverseDragsIntoImagePixels() throws {
        let bounds = NativeRect(x: 0, y: 0, width: 1_000, height: 500)

        let forward = try XCTUnwrap(NativeAnnotationPlacement.geometry(
            from: NativePoint(x: 20, y: 10),
            to: NativePoint(x: 120, y: 60),
            previewWidth: 200,
            previewHeight: 100,
            imageBounds: bounds
        ))
        let reverse = try XCTUnwrap(NativeAnnotationPlacement.geometry(
            from: NativePoint(x: 120, y: 60),
            to: NativePoint(x: 20, y: 10),
            previewWidth: 200,
            previewHeight: 100,
            imageBounds: bounds
        ))

        XCTAssertEqual(forward.x, 100)
        XCTAssertEqual(forward.y, 50)
        XCTAssertEqual(forward.width, 500)
        XCTAssertEqual(forward.height, 250)
        XCTAssertEqual(reverse.x, forward.x)
        XCTAssertEqual(reverse.y, forward.y)
        XCTAssertEqual(reverse.width, forward.width)
        XCTAssertEqual(reverse.height, forward.height)
    }

    func testMapsIntoExistingCropAndClampsOutsideDrag() throws {
        let geometry = try XCTUnwrap(NativeAnnotationPlacement.geometry(
            from: NativePoint(x: -50, y: -20),
            to: NativePoint(x: 250, y: 120),
            previewWidth: 200,
            previewHeight: 100,
            imageBounds: NativeRect(x: 100, y: 40, width: 800, height: 400)
        ))

        XCTAssertEqual(geometry.x, 100)
        XCTAssertEqual(geometry.y, 40)
        XCTAssertEqual(geometry.width, 800)
        XCTAssertEqual(geometry.height, 400)
    }

    func testTapProducesBoundedMinimumGeometry() throws {
        let geometry = try XCTUnwrap(NativeAnnotationPlacement.geometry(
            from: NativePoint(x: 200, y: 100),
            to: NativePoint(x: 200, y: 100),
            previewWidth: 200,
            previewHeight: 100,
            imageBounds: NativeRect(x: 0, y: 0, width: 1_000, height: 500)
        ))

        XCTAssertEqual(geometry.x + geometry.width, 1_000)
        XCTAssertEqual(geometry.y + geometry.height, 500)
        XCTAssertEqual(geometry.width, 40)
        XCTAssertEqual(geometry.height, 40)
    }

    func testRejectsInvalidPreviewOrImageBounds() {
        XCTAssertNil(NativeAnnotationPlacement.geometry(
            from: NativePoint(x: 0, y: 0),
            to: NativePoint(x: 10, y: 10),
            previewWidth: 0,
            previewHeight: 100,
            imageBounds: NativeRect(x: 0, y: 0, width: 100, height: 100)
        ))
        XCTAssertNil(NativeAnnotationPlacement.geometry(
            from: NativePoint(x: 0, y: 0),
            to: NativePoint(x: 10, y: 10),
            previewWidth: 100,
            previewHeight: 100,
            imageBounds: NativeRect(x: 0, y: 0, width: -1, height: 100)
        ))
    }
}
