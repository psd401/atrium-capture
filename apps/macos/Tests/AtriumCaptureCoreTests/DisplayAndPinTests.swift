import Foundation
import XCTest
@testable import AtriumCaptureCore

final class DisplayAndPinTests: XCTestCase {
    func testMapsQuartzRegionsAcrossMixedScaleDisplays() throws {
        let retina = NativeDisplay(
            id: 1,
            frame: NativeRect(x: 0, y: 0, width: 1_440, height: 900),
            pixelWidth: 2_880,
            pixelHeight: 1_800
        )
        let external = NativeDisplay(
            id: 2,
            frame: NativeRect(x: -1_920, y: 100, width: 1_920, height: 1_080),
            pixelWidth: 1_920,
            pixelHeight: 1_080
        )
        let displays = [retina, external]

        XCTAssertEqual(DisplayGeometry.display(containing: NativePoint(x: 100, y: 100), displays: displays)?.id, 1)
        XCTAssertEqual(DisplayGeometry.display(containing: NativePoint(x: -100, y: 200), displays: displays)?.id, 2)
        XCTAssertEqual(
            try DisplayGeometry.pixelRect(
                for: NativeRect(x: 100, y: 50, width: 200, height: 100),
                on: retina
            ),
            NativePixelRect(x: 200, y: 100, width: 400, height: 200)
        )
        XCTAssertEqual(
            try DisplayGeometry.pixelRect(
                for: NativeRect(x: -1_900, y: 120, width: 100, height: 80),
                on: external
            ),
            NativePixelRect(x: 20, y: 20, width: 100, height: 80)
        )
    }

    func testNormalizesSelectionsInEveryDragDirection() {
        XCTAssertEqual(
            DisplayGeometry.normalizedSelection(
                from: NativePoint(x: 200, y: 150),
                to: NativePoint(x: 50, y: 20)
            ),
            NativeRect(x: 50, y: 20, width: 150, height: 130)
        )
        XCTAssertNil(DisplayGeometry.normalizedSelection(
            from: NativePoint(x: 1, y: 1),
            to: NativePoint(x: 1.5, y: 1.5)
        ))
    }

    func testSamplesRGBAWithoutReadingOutsideTheImage() {
        let bytes = Data([
            255, 0, 0, 255, 0, 255, 0, 255,
            0, 0, 255, 255, 255, 255, 255, 128,
        ])
        XCTAssertEqual(
            PixelSampler.rgba(data: bytes, width: 2, height: 2, bytesPerRow: 8, x: 1, y: 0)?.hexRGB,
            "#00FF00"
        )
        XCTAssertNil(PixelSampler.rgba(data: bytes, width: 2, height: 2, bytesPerRow: 8, x: 2, y: 0))
    }

    func testPinHistoryPersistsGroupsClickThroughAndEvictsOldest() throws {
        let persistence = MemoryPinBoardPersistence()
        let board = try PinBoard(persistence: persistence, maximumPins: 2, maximumBytes: 100)
        let first = makePin(id: "one", bytes: 40, timestamp: 1)
        let second = makePin(id: "two", bytes: 40, timestamp: 2)
        let third = makePin(id: "three", bytes: 40, timestamp: 3)
        _ = try board.add(first)
        _ = try board.add(second)
        let evicted = try board.add(third)
        XCTAssertEqual(evicted, [first.localKey])
        try board.setClickThrough(pinID: second.id, enabled: true)
        try board.setGroup(pinID: second.id, groupID: "review")
        let movedFrame = NativeRect(x: -500, y: 40, width: 300, height: 150)
        try board.setFrame(pinID: second.id, frame: movedFrame, displayID: 7)

        let restarted = try PinBoard(persistence: persistence)
        XCTAssertEqual(restarted.snapshot().pins.map(\.id), ["two", "three"])
        XCTAssertTrue(restarted.snapshot().pins[0].clickThrough)
        XCTAssertEqual(restarted.snapshot().pins[0].groupID, "review")
        XCTAssertEqual(restarted.snapshot().pins[0].frame, movedFrame)
        XCTAssertEqual(restarted.snapshot().pins[0].displayID, 7)
    }

    func testClipboardRetentionPersistsWithoutClipboardContent() throws {
        let persistence = MemoryPinBoardPersistence()
        let board = try PinBoard(persistence: persistence)
        try board.setClipboardRetention(.clearAfterSeconds(15))
        let encoded = try XCTUnwrap(persistence.load())
        let text = String(decoding: encoded, as: UTF8.self)
        XCTAssertTrue(text.contains("clearAfterSeconds"))
        XCTAssertFalse(text.localizedCaseInsensitiveContains("pasteboard data"))
        XCTAssertEqual(try PinBoard(persistence: persistence).snapshot().clipboardRetention, .clearAfterSeconds(15))
    }

    func testPersistedPinBoundsAreNormalizedAndInvalidPinsFailClosed() throws {
        let normalized = MemoryPinBoardPersistence(data: Data("""
        {"pins":[],"maximumPins":999,"maximumBytes":9999999999,"clipboardRetention":{"mode":"clearAfterSeconds","seconds":999999}}
        """.utf8))
        let board = try PinBoard(persistence: normalized)
        XCTAssertEqual(board.snapshot().maximumPins, 100)
        XCTAssertEqual(board.snapshot().maximumBytes, 2 * 1_024 * 1_024 * 1_024)
        XCTAssertEqual(board.snapshot().clipboardRetention, .clearAfterSeconds(86_400))

        let invalid = MemoryPinBoardPersistence(data: Data("""
        {"pins":[{"id":"bad","localKey":"pins/bad.png","title":"bad","frame":{"x":0,"y":0,"width":0,"height":10},"displayID":1,"clickThrough":false,"createdAt":0,"byteCount":10}],"maximumPins":20,"maximumBytes":268435456,"clipboardRetention":{"mode":"doNotCopy"}}
        """.utf8))
        XCTAssertThrowsError(try PinBoard(persistence: invalid))
    }

    private func makePin(id: String, bytes: Int, timestamp: TimeInterval) -> PinnedCapture {
        PinnedCapture(
            id: id,
            localKey: "pins/\(id).png",
            title: "Synthetic pin \(id)",
            frame: NativeRect(x: 20, y: 20, width: 200, height: 100),
            displayID: 1,
            clickThrough: false,
            groupID: nil,
            createdAt: Date(timeIntervalSince1970: timestamp),
            byteCount: bytes
        )
    }
}
