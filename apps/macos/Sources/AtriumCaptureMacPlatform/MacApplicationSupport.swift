import AtriumCaptureCore
import Foundation

public enum MacApplicationSupport {
    public static func rootURL(
        fileManager: FileManager = .default,
        environment: [String: String] = ProcessInfo.processInfo.environment
    ) throws -> URL {
        let localMock = environment["ATRIUM_CAPTURE_LOCAL_MOCK"] == "1"
        let productionAcceptance =
            environment["ATRIUM_CAPTURE_PRODUCTION_ACCEPTANCE"] == "1"
                && environment["ATRIUM_CAPTURE_UI_FIXTURE"] == "review"
        if (localMock || productionAcceptance),
           let override = environment["ATRIUM_CAPTURE_DATA_ROOT"] {
            guard
                !override.isEmpty,
                override.utf8.count <= 4_096,
                !override.contains("\0"),
                override.hasPrefix("/")
            else {
                throw CocoaError(.fileReadInvalidFileName)
            }
            let root = URL(fileURLWithPath: override, isDirectory: true).standardizedFileURL
            if productionAcceptance {
                let temporaryRoot = fileManager.temporaryDirectory.standardizedFileURL
                let requiredPrefix = temporaryRoot
                    .appendingPathComponent(
                        "atrium-capture-production-acceptance.",
                        isDirectory: true
                    )
                    .path
                let systemTemporaryPrefix = "/private/tmp/atrium-capture-production-acceptance."
                // Foundation canonicalizes macOS's /private/tmp symlink to /tmp
                // for some callers. Both prefixes name the same system-owned
                // temporary directory and remain scoped by the fixed basename.
                let normalizedSystemTemporaryPrefix =
                    "/tmp/atrium-capture-production-acceptance."
                guard root.path.hasPrefix(requiredPrefix)
                    || root.path.hasPrefix(systemTemporaryPrefix)
                    || root.path.hasPrefix(normalizedSystemTemporaryPrefix)
                else {
                    throw CocoaError(.fileReadNoPermission)
                }
            }
            try fileManager.createDirectory(at: root, withIntermediateDirectories: true)
            return root
        }
        let base = try fileManager.url(
            for: .applicationSupportDirectory,
            in: .userDomainMask,
            appropriateFor: nil,
            create: true
        )
        let root = base.appendingPathComponent("AtriumCapture", isDirectory: true)
        try fileManager.createDirectory(at: root, withIntermediateDirectories: true)
        return root
    }
}

public final class NativeAssetVault: @unchecked Sendable {
    private let rootURL: URL
    private let lock = NSLock()

    public init(rootURL: URL) {
        self.rootURL = rootURL.standardizedFileURL
    }

    public func writeRaw(
        frame: NativeCapturedFrame,
        sessionID: String,
        assetID: String = UUID().uuidString.lowercased()
    ) throws -> NativeCapturedAsset {
        try write(
            data: frame.pngData,
            sessionID: sessionID,
            assetID: assetID,
            folder: "raw",
            pixelWidth: frame.pixelWidth,
            pixelHeight: frame.pixelHeight
        )
    }

    public func writePublishable(
        pngData: Data,
        sessionID: String,
        pixelWidth: Int,
        pixelHeight: Int,
        assetID: String = UUID().uuidString.lowercased()
    ) throws -> NativeCapturedAsset {
        try write(
            data: pngData,
            sessionID: sessionID,
            assetID: assetID,
            folder: "publishable",
            pixelWidth: pixelWidth,
            pixelHeight: pixelHeight
        )
    }

    public func writePin(
        pngData: Data,
        pixelWidth: Int,
        pixelHeight: Int,
        pinID: String = UUID().uuidString.lowercased()
    ) throws -> NativeCapturedAsset {
        try write(
            data: pngData,
            sessionID: "pin-history",
            assetID: pinID,
            folder: "pins",
            pixelWidth: pixelWidth,
            pixelHeight: pixelHeight
        )
    }

    public func delete(localKey: String) throws {
        lock.lock()
        defer { lock.unlock() }
        let url = try safeURL(localKey)
        if FileManager.default.fileExists(atPath: url.path) {
            try FileManager.default.removeItem(at: url)
        }
    }

    public func read(localKey: String) throws -> Data {
        lock.lock()
        defer { lock.unlock() }
        return try Data(contentsOf: safeURL(localKey))
    }

    private func write(
        data: Data,
        sessionID: String,
        assetID: String,
        folder: String,
        pixelWidth: Int,
        pixelHeight: Int
    ) throws -> NativeCapturedAsset {
        guard !data.isEmpty, pixelWidth > 0, pixelHeight > 0 else {
            throw CocoaError(.fileWriteUnknown)
        }
        let localKey = "assets/\(safeComponent(sessionID))/\(folder)/\(safeComponent(assetID)).png"
        lock.lock()
        defer { lock.unlock() }
        let url = try safeURL(localKey)
        try FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
        try data.write(to: url, options: .atomic)
        return NativeCapturedAsset(
            assetID: assetID,
            localKey: localKey,
            sha256: Self.sha256Hex(data),
            pixelWidth: pixelWidth,
            pixelHeight: pixelHeight
        )
    }

    private func safeURL(_ localKey: String) throws -> URL {
        let url = rootURL.appendingPathComponent(localKey).standardizedFileURL
        let prefix = rootURL.path.hasSuffix("/") ? rootURL.path : rootURL.path + "/"
        guard url.path.hasPrefix(prefix) else { throw CocoaError(.fileWriteNoPermission) }
        return url
    }

    private func safeComponent(_ value: String) -> String {
        let allowed = CharacterSet.alphanumerics.union(CharacterSet(charactersIn: "-_"))
        let filtered = value.unicodeScalars.filter(allowed.contains).map(String.init).joined()
        return filtered.isEmpty ? UUID().uuidString.lowercased() : filtered
    }

    private static func sha256Hex(_ data: Data) -> String {
        #if canImport(CryptoKit)
        return SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined()
        #else
        // This target's Linux build exists only for structural validation; capture is macOS-only.
        return String(repeating: "0", count: 64)
        #endif
    }
}

#if canImport(CryptoKit)
import CryptoKit
#endif
