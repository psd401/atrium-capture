import Foundation

public enum ClipboardRetention: Codable, Equatable, Sendable {
    case keepUntilReplaced
    case clearAfterSeconds(Int)
    case doNotCopy

    private enum CodingKeys: String, CodingKey { case mode, seconds }
    private enum Mode: String, Codable { case keepUntilReplaced, clearAfterSeconds, doNotCopy }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        switch try container.decode(Mode.self, forKey: .mode) {
        case .keepUntilReplaced: self = .keepUntilReplaced
        case .doNotCopy: self = .doNotCopy
        case .clearAfterSeconds:
            self = .clearAfterSeconds(min(max(1, try container.decode(Int.self, forKey: .seconds)), 86_400))
        }
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        switch self {
        case .keepUntilReplaced:
            try container.encode(Mode.keepUntilReplaced, forKey: .mode)
        case .doNotCopy:
            try container.encode(Mode.doNotCopy, forKey: .mode)
        case let .clearAfterSeconds(seconds):
            try container.encode(Mode.clearAfterSeconds, forKey: .mode)
            try container.encode(min(max(1, seconds), 86_400), forKey: .seconds)
        }
    }
}

public struct PinnedCapture: Codable, Equatable, Sendable {
    public let id: String
    public let localKey: String
    public let title: String
    public let frame: NativeRect
    public let displayID: UInt32
    public let clickThrough: Bool
    public let groupID: String?
    public let createdAt: Date
    public let byteCount: Int

    public init(
        id: String,
        localKey: String,
        title: String,
        frame: NativeRect,
        displayID: UInt32,
        clickThrough: Bool,
        groupID: String?,
        createdAt: Date,
        byteCount: Int
    ) {
        self.id = id
        self.localKey = localKey
        self.title = String(title.prefix(120))
        self.frame = frame
        self.displayID = displayID
        self.clickThrough = clickThrough
        self.groupID = groupID
        self.createdAt = createdAt
        self.byteCount = max(0, byteCount)
    }

    public func with(
        frame: NativeRect? = nil,
        displayID: UInt32? = nil,
        clickThrough: Bool? = nil,
        groupID: String?? = nil
    ) -> PinnedCapture {
        PinnedCapture(
            id: id,
            localKey: localKey,
            title: title,
            frame: frame ?? self.frame,
            displayID: displayID ?? self.displayID,
            clickThrough: clickThrough ?? self.clickThrough,
            groupID: groupID ?? self.groupID,
            createdAt: createdAt,
            byteCount: byteCount
        )
    }
}

public struct PinBoardSnapshot: Codable, Equatable, Sendable {
    public let pins: [PinnedCapture]
    public let maximumPins: Int
    public let maximumBytes: Int
    public let clipboardRetention: ClipboardRetention

    public init(
        pins: [PinnedCapture],
        maximumPins: Int = 20,
        maximumBytes: Int = 256 * 1_024 * 1_024,
        clipboardRetention: ClipboardRetention = .clearAfterSeconds(120)
    ) {
        self.pins = pins
        self.maximumPins = min(max(maximumPins, 1), 100)
        self.maximumBytes = min(max(maximumBytes, 1_024 * 1_024), 2 * 1_024 * 1_024 * 1_024)
        self.clipboardRetention = clipboardRetention
    }
}

public protocol PinBoardPersistence: AnyObject {
    func load() throws -> Data?
    func save(_ data: Data) throws
}

public final class MemoryPinBoardPersistence: PinBoardPersistence, @unchecked Sendable {
    private var data: Data?
    private let lock = NSLock()

    public init(data: Data? = nil) { self.data = data }
    public func load() -> Data? { lock.withLock { data } }
    public func save(_ data: Data) { lock.withLock { self.data = data } }
}

public final class FilePinBoardPersistence: PinBoardPersistence, @unchecked Sendable {
    private let url: URL
    private let lock = NSLock()

    public init(url: URL) { self.url = url }
    public func load() throws -> Data? {
        try lock.withLock {
            guard FileManager.default.fileExists(atPath: url.path) else { return nil }
            return try Data(contentsOf: url)
        }
    }
    public func save(_ data: Data) throws {
        try lock.withLock {
            try FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
            try data.write(to: url, options: .atomic)
        }
    }
}

public enum PinBoardError: Error, Equatable {
    case pinNotFound
    case invalidPin
}

public final class PinBoard: @unchecked Sendable {
    private let persistence: any PinBoardPersistence
    private let lock = NSLock()
    private var snapshotValue: PinBoardSnapshot

    public init(
        persistence: any PinBoardPersistence,
        maximumPins: Int = 20,
        maximumBytes: Int = 256 * 1_024 * 1_024,
        clipboardRetention: ClipboardRetention = .clearAfterSeconds(120)
    ) throws {
        self.persistence = persistence
        if let data = try persistence.load() {
            let decoded = try JSONDecoder().decode(PinBoardSnapshot.self, from: data)
            let limits = PinBoardSnapshot(
                pins: [],
                maximumPins: decoded.maximumPins,
                maximumBytes: decoded.maximumBytes,
                clipboardRetention: decoded.clipboardRetention
            )
            guard decoded.pins.allSatisfy({ pin in
                !pin.id.isEmpty && pin.id.count <= 128
                    && !pin.localKey.isEmpty && pin.localKey.count <= 1_024
                    && pin.title.count <= 120
                    && pin.frame.isValid
                    && pin.byteCount > 0 && pin.byteCount <= limits.maximumBytes
            }), Set(decoded.pins.map(\.id)).count == decoded.pins.count else {
                throw PinBoardError.invalidPin
            }
            var pins = decoded.pins.sorted { $0.createdAt < $1.createdAt }
            while pins.count > limits.maximumPins
                || pins.reduce(0, { partial, pin in partial + pin.byteCount }) > limits.maximumBytes {
                pins.removeFirst()
            }
            snapshotValue = PinBoardSnapshot(
                pins: pins,
                maximumPins: limits.maximumPins,
                maximumBytes: limits.maximumBytes,
                clipboardRetention: limits.clipboardRetention
            )
            if snapshotValue != decoded {
                try persistence.save(JSONEncoder().encode(snapshotValue))
            }
        } else {
            snapshotValue = PinBoardSnapshot(
                pins: [],
                maximumPins: maximumPins,
                maximumBytes: maximumBytes,
                clipboardRetention: clipboardRetention
            )
        }
    }

    public func snapshot() -> PinBoardSnapshot { lock.withLock { snapshotValue } }

    /// Returns evicted local keys so the platform can delete their image bytes.
    @discardableResult
    public func add(_ pin: PinnedCapture) throws -> [String] {
        guard pin.frame.isValid, pin.byteCount > 0 else { throw PinBoardError.invalidPin }
        return try lock.withLock {
            var pins = snapshotValue.pins.filter { $0.id != pin.id }
            pins.append(pin)
            pins.sort { $0.createdAt < $1.createdAt }
            var evicted: [String] = []
            while pins.count > snapshotValue.maximumPins
                || pins.reduce(0, { $0 + $1.byteCount }) > snapshotValue.maximumBytes {
                evicted.append(pins.removeFirst().localKey)
            }
            try persist(pins: pins)
            return evicted
        }
    }

    public func setClickThrough(pinID: String, enabled: Bool) throws {
        try mutate(pinID: pinID) { $0.with(clickThrough: enabled) }
    }

    public func setFrame(pinID: String, frame: NativeRect, displayID: UInt32) throws {
        guard frame.isValid else { throw PinBoardError.invalidPin }
        try mutate(pinID: pinID) { $0.with(frame: frame, displayID: displayID) }
    }

    public func setGroup(pinID: String, groupID: String?) throws {
        let cleanGroup = groupID.map { String($0.prefix(80)) }
        try mutate(pinID: pinID) { $0.with(groupID: .some(cleanGroup)) }
    }

    @discardableResult
    public func remove(pinID: String) throws -> String {
        try lock.withLock {
            guard let index = snapshotValue.pins.firstIndex(where: { $0.id == pinID }) else {
                throw PinBoardError.pinNotFound
            }
            var pins = snapshotValue.pins
            let removed = pins.remove(at: index)
            try persist(pins: pins)
            return removed.localKey
        }
    }

    @discardableResult
    public func clearHistory() throws -> [String] {
        try lock.withLock {
            let keys = snapshotValue.pins.map(\.localKey)
            try persist(pins: [])
            return keys
        }
    }

    public func setClipboardRetention(_ retention: ClipboardRetention) throws {
        try lock.withLock {
            snapshotValue = PinBoardSnapshot(
                pins: snapshotValue.pins,
                maximumPins: snapshotValue.maximumPins,
                maximumBytes: snapshotValue.maximumBytes,
                clipboardRetention: retention
            )
            try persistence.save(JSONEncoder().encode(snapshotValue))
        }
    }

    private func mutate(pinID: String, transform: (PinnedCapture) -> PinnedCapture) throws {
        try lock.withLock {
            guard snapshotValue.pins.contains(where: { $0.id == pinID }) else { throw PinBoardError.pinNotFound }
            try persist(pins: snapshotValue.pins.map { $0.id == pinID ? transform($0) : $0 })
        }
    }

    private func persist(pins: [PinnedCapture]) throws {
        let next = PinBoardSnapshot(
            pins: pins,
            maximumPins: snapshotValue.maximumPins,
            maximumBytes: snapshotValue.maximumBytes,
            clipboardRetention: snapshotValue.clipboardRetention
        )
        try persistence.save(JSONEncoder().encode(next))
        snapshotValue = next
    }
}
