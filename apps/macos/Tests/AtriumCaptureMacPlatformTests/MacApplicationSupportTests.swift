#if os(macOS)
import AtriumCaptureMacPlatform
import Foundation
import Testing

@Suite("Mac application support")
struct MacApplicationSupportTests {
    @Test("local mock can use an isolated synthetic data root")
    func localMockDataRoot() throws {
        let root = FileManager.default.temporaryDirectory
            .appendingPathComponent("atrium-capture-support-\(UUID().uuidString)", isDirectory: true)
        defer { try? FileManager.default.removeItem(at: root) }

        let resolved = try MacApplicationSupport.rootURL(
            environment: [
                "ATRIUM_CAPTURE_DATA_ROOT": root.path,
                "ATRIUM_CAPTURE_LOCAL_MOCK": "1",
            ]
        )

        #expect(
            resolved.resolvingSymlinksInPath()
                == root.standardizedFileURL.resolvingSymlinksInPath()
        )
        #expect(FileManager.default.fileExists(atPath: resolved.path))
    }

    @Test("data-root override fails closed outside local mock mode")
    func productionIgnoresDataRootOverride() throws {
        let synthetic = "/tmp/atrium-capture-must-not-be-used"
        let resolved = try MacApplicationSupport.rootURL(
            environment: ["ATRIUM_CAPTURE_DATA_ROOT": synthetic]
        )

        #expect(resolved.path != synthetic)
        #expect(resolved.lastPathComponent == "AtriumCapture")
    }

    @Test("production acceptance can use only its isolated synthetic temporary root")
    func productionAcceptanceRootIsBounded() throws {
        let root = URL(
            fileURLWithPath:
                "/private/tmp/atrium-capture-production-acceptance.\(UUID().uuidString)",
            isDirectory: true
        )
        defer { try? FileManager.default.removeItem(at: root) }
        let resolved = try MacApplicationSupport.rootURL(
            environment: [
                "ATRIUM_CAPTURE_DATA_ROOT": root.path,
                "ATRIUM_CAPTURE_PRODUCTION_ACCEPTANCE": "1",
                "ATRIUM_CAPTURE_UI_FIXTURE": "review",
            ]
        )

        #expect(
            resolved.resolvingSymlinksInPath()
                == root.standardizedFileURL.resolvingSymlinksInPath()
        )
        #expect(FileManager.default.fileExists(atPath: resolved.path))
        #expect(throws: (any Error).self) {
            try MacApplicationSupport.rootURL(
                environment: [
                    "ATRIUM_CAPTURE_DATA_ROOT": "/private/tmp/unbounded-production-data",
                    "ATRIUM_CAPTURE_PRODUCTION_ACCEPTANCE": "1",
                    "ATRIUM_CAPTURE_UI_FIXTURE": "review",
                ]
            )
        }
    }

    @Test("local mock rejects a relative data root")
    func localMockRejectsRelativeRoot() {
        #expect(throws: (any Error).self) {
            try MacApplicationSupport.rootURL(
                environment: [
                    "ATRIUM_CAPTURE_DATA_ROOT": "relative/test-data",
                    "ATRIUM_CAPTURE_LOCAL_MOCK": "1",
                ]
            )
        }
    }
}
#endif
