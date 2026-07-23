import AtriumCaptureContracts
import Foundation

public struct NativeAtriumCapabilities: Equatable, Sendable {
    public let oauth: Bool
    public let privateDrafts: Bool
    public let assetUpload: Bool
    public let versionCreation: Bool
    public let internalPublish: Bool
    public let blocker: String?

    public init(
        oauth: Bool,
        privateDrafts: Bool,
        assetUpload: Bool,
        versionCreation: Bool,
        internalPublish: Bool,
        blocker: String?
    ) {
        self.oauth = oauth
        self.privateDrafts = privateDrafts
        self.assetUpload = assetUpload
        self.versionCreation = versionCreation
        self.internalPublish = internalPublish
        self.blocker = blocker
    }

    public static let unavailable = NativeAtriumCapabilities(
        oauth: false,
        privateDrafts: false,
        assetUpload: false,
        versionCreation: false,
        internalPublish: false,
        blocker: "ATRIUM_API_UNAVAILABLE"
    )
}

public struct NativeDraftResult: Equatable, Sendable {
    public let objectID: String

    public init(objectID: String) {
        self.objectID = objectID
    }
}

public struct NativeAssetResult: Equatable, Sendable {
    public let assetID: String

    public init(assetID: String) {
        self.assetID = assetID
    }
}

public struct NativeVersionResult: Equatable, Sendable {
    public let versionID: String
    public let readerURL: String

    public init(versionID: String, readerURL: String) {
        self.versionID = versionID
        self.readerURL = readerURL
    }
}

public struct NativeGatewayFailure: Error, Equatable, Sendable {
    public let code: String
    public let retryable: Bool

    public init(code: String, retryable: Bool) {
        self.code = code
        self.retryable = retryable
    }
}

public protocol NativeAtriumGateway: AnyObject {
    var capabilities: NativeAtriumCapabilities { get }
    func createPrivateDraft(title: String, idempotencyKey: String) throws -> NativeDraftResult
    func uploadPublishableAsset(
        objectID: String,
        pngData: Data,
        sha256: String,
        idempotencyKey: String
    ) throws -> NativeAssetResult
    func createVersion(
        objectID: String,
        markdown: String,
        remoteAssetIDs: [String],
        idempotencyKey: String
    ) throws -> NativeVersionResult
    func publishInternal(objectID: String, versionID: String, idempotencyKey: String) throws
}

public final class UnavailableNativeAtriumGateway: NativeAtriumGateway {
    public let capabilities = NativeAtriumCapabilities.unavailable

    public init() {}

    public func createPrivateDraft(title _: String, idempotencyKey _: String) throws -> NativeDraftResult {
        throw NativeGatewayFailure(code: "ATRIUM_API_UNAVAILABLE", retryable: false)
    }

    public func uploadPublishableAsset(
        objectID _: String,
        pngData _: Data,
        sha256 _: String,
        idempotencyKey _: String
    ) throws -> NativeAssetResult {
        throw NativeGatewayFailure(code: "ATRIUM_API_UNAVAILABLE", retryable: false)
    }

    public func createVersion(
        objectID _: String,
        markdown _: String,
        remoteAssetIDs _: [String],
        idempotencyKey _: String
    ) throws -> NativeVersionResult {
        throw NativeGatewayFailure(code: "ATRIUM_API_UNAVAILABLE", retryable: false)
    }

    public func publishInternal(objectID _: String, versionID _: String, idempotencyKey _: String) throws {
        throw NativeGatewayFailure(code: "ATRIUM_API_UNAVAILABLE", retryable: false)
    }
}

public protocol NativePublishRepository: AnyObject {
    func saveSession(_ session: AtriumCaptureSession) throws
    func loadSession(sessionID: String) throws -> AtriumCaptureSession?
    func saveJob(_ job: AtriumCapturePublishJob) throws
    func loadJob(jobID: String) throws -> AtriumCapturePublishJob?
    func assetData(localKey: String) throws -> Data
    func deleteRawAssets(sessionID: String) throws
}

public final class FileNativePublishRepository: NativePublishRepository, @unchecked Sendable {
    private let rootURL: URL
    private let lock = NSLock()

    public init(rootURL: URL) {
        self.rootURL = rootURL.standardizedFileURL
    }

    public func saveSession(_ session: AtriumCaptureSession) throws {
        try save(
            AtriumContractCodec.makeEncoder().encode(session),
            directory: "sessions",
            name: session.sessionID
        )
    }

    public func loadSession(sessionID: String) throws -> AtriumCaptureSession? {
        guard let data = try load(directory: "sessions", name: sessionID) else { return nil }
        return try AtriumContractCodec.makeDecoder().decode(AtriumCaptureSession.self, from: data)
    }

    public func saveJob(_ job: AtriumCapturePublishJob) throws {
        try save(
            AtriumContractCodec.makeEncoder().encode(job),
            directory: "outbox",
            name: job.jobID
        )
    }

    public func loadJob(jobID: String) throws -> AtriumCapturePublishJob? {
        guard let data = try load(directory: "outbox", name: jobID) else { return nil }
        return try AtriumContractCodec.makeDecoder().decode(AtriumCapturePublishJob.self, from: data)
    }

    public func assetData(localKey: String) throws -> Data {
        lock.lock()
        defer { lock.unlock() }
        let url = try safeAssetURL(localKey)
        return try Data(contentsOf: url)
    }

    public func deleteRawAssets(sessionID: String) throws {
        lock.lock()
        defer { lock.unlock() }
        guard let sessionData = try loadUnlocked(directory: "sessions", name: sessionID) else { return }
        let session = try AtriumContractCodec.makeDecoder().decode(AtriumCaptureSession.self, from: sessionData)
        var assets: [AssetElement] = []
        for asset in session.assets {
            guard asset.state == .rawLocal else {
                assets.append(asset)
                continue
            }
            let url = try safeAssetURL(asset.localKey)
            if FileManager.default.fileExists(atPath: url.path) {
                try FileManager.default.removeItem(at: url)
            }
            assets.append(asset.with(state: .deleted))
        }
        let updated = session.with(assets: assets, revision: session.revision + 1, updatedAt: Date())
        try saveUnlocked(
            AtriumContractCodec.makeEncoder().encode(updated),
            directory: "sessions",
            name: sessionID
        )
    }

    private func save(_ data: Data, directory: String, name: String) throws {
        lock.lock()
        defer { lock.unlock() }
        try saveUnlocked(data, directory: directory, name: name)
    }

    private func load(directory: String, name: String) throws -> Data? {
        lock.lock()
        defer { lock.unlock() }
        return try loadUnlocked(directory: directory, name: name)
    }

    private func saveUnlocked(_ data: Data, directory: String, name: String) throws {
        let url = try recordURL(directory: directory, name: name)
        try FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
        try data.write(to: url, options: .atomic)
    }

    private func loadUnlocked(directory: String, name: String) throws -> Data? {
        let url = try recordURL(directory: directory, name: name)
        guard FileManager.default.fileExists(atPath: url.path) else { return nil }
        return try Data(contentsOf: url)
    }

    private func recordURL(directory: String, name: String) throws -> URL {
        let allowed = CharacterSet.alphanumerics.union(CharacterSet(charactersIn: "-_"))
        guard !name.isEmpty, name.unicodeScalars.allSatisfy(allowed.contains) else {
            throw CocoaError(.fileReadInvalidFileName)
        }
        return rootURL.appendingPathComponent(directory, isDirectory: true).appendingPathComponent("\(name).json")
    }

    private func safeAssetURL(_ localKey: String) throws -> URL {
        let url = rootURL.appendingPathComponent(localKey).standardizedFileURL
        let rootPath = rootURL.path.hasSuffix("/") ? rootURL.path : rootURL.path + "/"
        guard url.path.hasPrefix(rootPath) else { throw CocoaError(.fileReadNoPermission) }
        return url
    }
}

public final class MemoryNativePublishRepository: NativePublishRepository, @unchecked Sendable {
    private let lock = NSLock()
    private var sessions: [String: Data] = [:]
    private var jobs: [String: Data] = [:]
    private var assets: [String: Data]

    public init(assets: [String: Data] = [:]) {
        self.assets = assets
    }

    public func setAsset(_ data: Data, localKey: String) {
        lock.lock()
        assets[localKey] = data
        lock.unlock()
    }

    public func saveSession(_ session: AtriumCaptureSession) throws {
        lock.lock()
        defer { lock.unlock() }
        sessions[session.sessionID] = try AtriumContractCodec.makeEncoder().encode(session)
    }

    public func loadSession(sessionID: String) throws -> AtriumCaptureSession? {
        lock.lock()
        defer { lock.unlock() }
        guard let data = sessions[sessionID] else { return nil }
        return try AtriumContractCodec.makeDecoder().decode(AtriumCaptureSession.self, from: data)
    }

    public func saveJob(_ job: AtriumCapturePublishJob) throws {
        lock.lock()
        defer { lock.unlock() }
        jobs[job.jobID] = try AtriumContractCodec.makeEncoder().encode(job)
    }

    public func loadJob(jobID: String) throws -> AtriumCapturePublishJob? {
        lock.lock()
        defer { lock.unlock() }
        guard let data = jobs[jobID] else { return nil }
        return try AtriumContractCodec.makeDecoder().decode(AtriumCapturePublishJob.self, from: data)
    }

    public func assetData(localKey: String) throws -> Data {
        lock.lock()
        defer { lock.unlock() }
        guard let data = assets[localKey] else { throw CocoaError(.fileReadNoSuchFile) }
        return data
    }

    public func deleteRawAssets(sessionID: String) throws {
        lock.lock()
        defer { lock.unlock() }
        guard let data = sessions[sessionID] else { return }
        let session = try AtriumContractCodec.makeDecoder().decode(AtriumCaptureSession.self, from: data)
        let rawKeys = session.assets.filter { $0.state == .rawLocal }.map(\.localKey)
        rawKeys.forEach { assets.removeValue(forKey: $0) }
        let updated = session.with(
            assets: session.assets.map { $0.state == .rawLocal ? $0.with(state: .deleted) : $0 },
            revision: session.revision + 1,
            updatedAt: Date()
        )
        sessions[sessionID] = try AtriumContractCodec.makeEncoder().encode(updated)
    }
}

public enum NativePublishError: Error, Equatable {
    case capabilityUnavailable
    case sessionNotFound
    case jobNotFound
    case reviewRequired
    case rawAssetRejected
    case needsAttention
    case gateway(code: String)
}

public final class DurableNativePublisher: @unchecked Sendable {
    private let repository: any NativePublishRepository
    private let gateway: any NativeAtriumGateway
    private let lock = NSLock()

    public init(repository: any NativePublishRepository, gateway: any NativeAtriumGateway) {
        self.repository = repository
        self.gateway = gateway
    }

    public var capabilities: NativeAtriumCapabilities { gateway.capabilities }

    public func enqueue(
        session: AtriumCaptureSession,
        collectionID: String? = nil,
        jobID: String = UUID().uuidString.lowercased(),
        now: Date = Date()
    ) throws -> AtriumCapturePublishJob {
        lock.lock()
        defer { lock.unlock() }
        guard gateway.capabilities.privateDrafts,
              gateway.capabilities.assetUpload,
              gateway.capabilities.versionCreation
        else { throw NativePublishError.capabilityUnavailable }
        guard session.state == .publishable, session.policy.reviewStatus == .approved else {
            throw NativePublishError.reviewRequired
        }
        guard session.steps.allSatisfy({ $0.privacyReview == .approved }) else {
            throw NativePublishError.reviewRequired
        }
        do {
            try NativeReviewEditor.validatePrivacyAnnotations(in: session)
        } catch {
            throw NativePublishError.reviewRequired
        }
        let referencedAssetIDs = Set(session.steps.compactMap(\.screenshotAssetID))
        guard session.assets.allSatisfy({
            $0.state == .deleted
                || ($0.state == .publishableLocal && referencedAssetIDs.contains($0.assetID))
        }), referencedAssetIDs.allSatisfy({ assetID in
            session.assets.contains { $0.assetID == assetID && $0.state == .publishableLocal }
        }) else {
            throw NativePublishError.rawAssetRejected
        }
        let uploads = session.assets
            .filter { $0.state == .publishableLocal && referencedAssetIDs.contains($0.assetID) }
            .map {
                AssetUpload(
                    idempotencyKey: "asset:\(jobID):\($0.assetID)",
                    localAssetID: $0.assetID,
                    remoteAssetID: nil,
                    state: .pending
                )
            }
        let job = AtriumCapturePublishJob(
            assetUploads: uploads,
            attemptCount: 0,
            collectionID: collectionID,
            contentObjectID: nil,
            createdAt: now,
            createIdempotencyKey: "object:\(jobID)",
            currentVersionID: nil,
            jobID: jobID,
            lastError: nil,
            phase: .queued,
            readerURL: nil,
            schemaVersion: .the10,
            sessionID: session.sessionID,
            updatedAt: now
        )
        try repository.saveSession(session)
        try repository.saveJob(job)
        return job
    }

    public func resume(jobID: String, publishInternal: Bool = false, now: Date = Date()) throws -> AtriumCapturePublishJob {
        lock.lock()
        defer { lock.unlock() }
        guard var job = try repository.loadJob(jobID: jobID) else { throw NativePublishError.jobNotFound }
        guard let session = try repository.loadSession(sessionID: job.sessionID) else {
            throw NativePublishError.sessionNotFound
        }
        guard job.phase != .needsAttention else { throw NativePublishError.needsAttention }

        do {
            if job.phase == .queued || job.phase == .creatingObject {
                job = job.with(lastError: .some(nil), phase: .creatingObject, updatedAt: now)
                try repository.saveJob(job)
                let draft = try gateway.createPrivateDraft(
                    title: session.title,
                    idempotencyKey: job.createIdempotencyKey
                )
                job = job.with(contentObjectID: .some(draft.objectID), phase: .uploadingAssets, updatedAt: now)
                try repository.saveJob(job)
            }

            if job.phase == .uploadingAssets {
                guard let objectID = job.contentObjectID else { throw NativePublishError.jobNotFound }
                var uploads = job.assetUploads ?? []
                for index in uploads.indices where uploads[index].state != .ready {
                    uploads[index] = uploads[index].with(state: .uploading)
                    job = job.with(assetUploads: uploads, updatedAt: now)
                    try repository.saveJob(job)
                    guard let asset = session.assets.first(where: {
                        $0.assetID == uploads[index].localAssetID && $0.state == .publishableLocal
                    }) else { throw NativePublishError.rawAssetRejected }
                    let data = try repository.assetData(localKey: asset.localKey)
                    let remote = try gateway.uploadPublishableAsset(
                        objectID: objectID,
                        pngData: data,
                        sha256: asset.sha256,
                        idempotencyKey: uploads[index].idempotencyKey
                    )
                    uploads[index] = uploads[index].with(
                        remoteAssetID: .some(remote.assetID),
                        state: .ready
                    )
                    job = job.with(assetUploads: uploads, updatedAt: now)
                    try repository.saveJob(job)
                }
                job = job.with(phase: .creatingVersion, updatedAt: now)
                try repository.saveJob(job)
            }

            if job.phase == .creatingVersion {
                guard let objectID = job.contentObjectID else { throw NativePublishError.jobNotFound }
                let result = try gateway.createVersion(
                    objectID: objectID,
                    markdown: Self.markdown(for: session),
                    remoteAssetIDs: (job.assetUploads ?? []).compactMap(\.remoteAssetID),
                    idempotencyKey: "version:\(job.jobID)"
                )
                job = job.with(
                    currentVersionID: .some(result.versionID),
                    phase: .readyAsDraft,
                    readerURL: .some(result.readerURL),
                    updatedAt: now
                )
                try repository.saveJob(job)
                if session.policy.rawImageRetention == .deleteAfterSubmit {
                    try repository.deleteRawAssets(sessionID: session.sessionID)
                }
            }

            if job.phase == .publishingInternal || (publishInternal && job.phase == .readyAsDraft) {
                guard gateway.capabilities.internalPublish else {
                    throw NativePublishError.capabilityUnavailable
                }
                guard let objectID = job.contentObjectID, let versionID = job.currentVersionID else {
                    throw NativePublishError.jobNotFound
                }
                if job.phase == .readyAsDraft {
                    job = job.with(phase: .publishingInternal, updatedAt: now)
                    try repository.saveJob(job)
                }
                try gateway.publishInternal(
                    objectID: objectID,
                    versionID: versionID,
                    idempotencyKey: "publish:\(job.jobID)"
                )
                job = job.with(phase: .complete, updatedAt: now)
                try repository.saveJob(job)
            }
            return job
        } catch let failure as NativeGatewayFailure {
            let failedPhase: Phase = failure.retryable ? job.phase : .needsAttention
            job = job.with(
                attemptCount: job.attemptCount + 1,
                lastError: .some(LastError(
                    code: failure.code,
                    message: failure.code,
                    requestID: nil,
                    retryable: failure.retryable
                )),
                phase: failedPhase,
                updatedAt: now
            )
            try repository.saveJob(job)
            throw NativePublishError.gateway(code: failure.code)
        }
    }

    private static func markdown(for session: AtriumCaptureSession) -> String {
        let lines = session.steps.map { step -> String in
            let raw = step.instruction.editedText ?? step.instruction.generatedText
            let escaped = raw
                .replacingOccurrences(of: "\\", with: "\\\\")
                .replacingOccurrences(of: "[", with: "\\[")
                .replacingOccurrences(of: "]", with: "\\]")
                .replacingOccurrences(of: "\n", with: " ")
            if let assetID = step.screenshotAssetID,
               session.assets.contains(where: { $0.assetID == assetID && $0.state == .publishableLocal }) {
                return "1. \(escaped)\n\n   ![Reviewed capture](asset://\(assetID))"
            }
            return "1. \(escaped)"
        }
        return "# \(session.title.replacingOccurrences(of: "\n", with: " "))\n\n" + lines.joined(separator: "\n")
    }
}

public enum MockNativeFailurePoint: String, Sendable {
    case object
    case asset
    case version
    case internalPublish
}

public final class MockNativeAtriumGateway: NativeAtriumGateway, @unchecked Sendable {
    public let capabilities = NativeAtriumCapabilities(
        oauth: true,
        privateDrafts: true,
        assetUpload: true,
        versionCreation: true,
        internalPublish: true,
        blocker: nil
    )
    private let lock = NSLock()
    private var objects: [String: NativeDraftResult] = [:]
    private var assets: [String: NativeAssetResult] = [:]
    private var versions: [String: NativeVersionResult] = [:]
    private var publishes: Set<String> = []
    private var failurePoint: MockNativeFailurePoint?

    public init(failAfterCommitAt failurePoint: MockNativeFailurePoint? = nil) {
        self.failurePoint = failurePoint
    }

    public var remoteCounts: (objects: Int, assets: Int, versions: Int, publishes: Int) {
        lock.lock()
        defer { lock.unlock() }
        return (objects.count, assets.count, versions.count, publishes.count)
    }

    public func createPrivateDraft(title _: String, idempotencyKey: String) throws -> NativeDraftResult {
        lock.lock()
        defer { lock.unlock() }
        let result = objects[idempotencyKey] ?? NativeDraftResult(objectID: "mock-object-\(objects.count + 1)")
        objects[idempotencyKey] = result
        try failOnce(.object)
        return result
    }

    public func uploadPublishableAsset(
        objectID _: String,
        pngData: Data,
        sha256 _: String,
        idempotencyKey: String
    ) throws -> NativeAssetResult {
        lock.lock()
        defer { lock.unlock() }
        guard !pngData.isEmpty else { throw NativeGatewayFailure(code: "EMPTY_ASSET", retryable: false) }
        let result = assets[idempotencyKey] ?? NativeAssetResult(assetID: "mock-asset-\(assets.count + 1)")
        assets[idempotencyKey] = result
        try failOnce(.asset)
        return result
    }

    public func createVersion(
        objectID _: String,
        markdown _: String,
        remoteAssetIDs _: [String],
        idempotencyKey: String
    ) throws -> NativeVersionResult {
        lock.lock()
        defer { lock.unlock() }
        let result = versions[idempotencyKey] ?? NativeVersionResult(
            versionID: "mock-version-\(versions.count + 1)",
            readerURL: "http://127.0.0.1/_mock/atrium-capture/reader"
        )
        versions[idempotencyKey] = result
        try failOnce(.version)
        return result
    }

    public func publishInternal(objectID _: String, versionID _: String, idempotencyKey: String) throws {
        lock.lock()
        defer { lock.unlock() }
        publishes.insert(idempotencyKey)
        try failOnce(.internalPublish)
    }

    private func failOnce(_ point: MockNativeFailurePoint) throws {
        guard failurePoint == point else { return }
        failurePoint = nil
        throw NativeGatewayFailure(code: "MOCK_LOST_RESPONSE", retryable: true)
    }
}
