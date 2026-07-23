import Foundation
import XCTest
@testable import AtriumCaptureContracts

final class ContractFixtureTests: XCTestCase {
    private func fixtureData(named name: String) throws -> Data {
        var repositoryRoot = URL(fileURLWithPath: #filePath)
        for _ in 0..<5 {
            repositoryRoot.deleteLastPathComponent()
        }

        return try Data(
            contentsOf: repositoryRoot
                .appendingPathComponent("packages/test-fixtures/fixtures")
                .appendingPathComponent(name)
        )
    }

    func testDecodesSharedCaptureSessionFixture() throws {
        let session = try AtriumContractCodec.makeDecoder().decode(
            AtriumCaptureSession.self,
            from: fixtureData(named: "capture-session-v1.json")
        )

        XCTAssertEqual(session.steps.count, 3)
        XCTAssertEqual(session.assets.count, 1)
    }

    func testDecodesSharedPublishJobFixture() throws {
        _ = try AtriumContractCodec.makeDecoder().decode(
            AtriumCapturePublishJob.self,
            from: fixtureData(named: "publish-job-v1.json")
        )
    }

    func testDecodesSharedReadyPublishJobFixture() throws {
        let job = try AtriumContractCodec.makeDecoder().decode(
            AtriumCapturePublishJob.self,
            from: fixtureData(named: "publish-job-ready-v1.json")
        )

        XCTAssertEqual(job.phase, .readyAsDraft)
        XCTAssertNotNil(job.readerURL)
    }

    func testDecodesSharedMetadataOnlyBridgeFixture() throws {
        let data = try fixtureData(named: "native-bridge-v1.json")
        _ = try AtriumContractCodec.makeDecoder().decode(
            AtriumCaptureNativeBridgeMessage.self,
            from: data
        )

        let text = String(decoding: data, as: UTF8.self)
        XCTAssertNil(text.range(of: "data:image", options: .caseInsensitive))
        XCTAssertNil(text.range(of: "bearer", options: .caseInsensitive))
        XCTAssertNil(text.range(of: "access_token", options: .caseInsensitive))
    }
}
