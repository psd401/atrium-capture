// Generated from contracts/*.schema.json. Do not edit by hand.

// This file was generated from JSON Schema using quicktype, do not modify it directly.
// To parse the JSON, add this file to your project and do:
//
//   let atriumCaptureSession = try AtriumCaptureSession(json)
//   let atriumCaptureNativeBridgeMessage = try AtriumCaptureNativeBridgeMessage(json)
//   let atriumCapturePublishJob = try AtriumCapturePublishJob(json)

import Foundation

// MARK: - AtriumCaptureSession
public struct AtriumCaptureSession: Codable {
    public let assets: [AssetElement]
    public let createdAt: Date
    public let policy: Policy
    public let recorder: Recorder
    public let revision: Int
    public let schemaVersion: SchemaVersion
    public let sessionID: String
    public let state: AtriumCaptureSessionState
    public let steps: [StepElement]
    public let title: String
    public let updatedAt: Date

    public enum CodingKeys: String, CodingKey {
        case assets = "assets"
        case createdAt = "createdAt"
        case policy = "policy"
        case recorder = "recorder"
        case revision = "revision"
        case schemaVersion = "schemaVersion"
        case sessionID = "sessionId"
        case state = "state"
        case steps = "steps"
        case title = "title"
        case updatedAt = "updatedAt"
    }

    public init(assets: [AssetElement], createdAt: Date, policy: Policy, recorder: Recorder, revision: Int, schemaVersion: SchemaVersion, sessionID: String, state: AtriumCaptureSessionState, steps: [StepElement], title: String, updatedAt: Date) {
        self.assets = assets
        self.createdAt = createdAt
        self.policy = policy
        self.recorder = recorder
        self.revision = revision
        self.schemaVersion = schemaVersion
        self.sessionID = sessionID
        self.state = state
        self.steps = steps
        self.title = title
        self.updatedAt = updatedAt
    }
}

// MARK: AtriumCaptureSession convenience initializers and mutators

public extension AtriumCaptureSession {
    init(data: Data) throws {
        self = try newJSONDecoder().decode(AtriumCaptureSession.self, from: data)
    }

    init(_ json: String, using encoding: String.Encoding = .utf8) throws {
        guard let data = json.data(using: encoding) else {
            throw NSError(domain: "JSONDecoding", code: 0, userInfo: nil)
        }
        try self.init(data: data)
    }

    init(fromURL url: URL) throws {
        try self.init(data: try Data(contentsOf: url))
    }

    func with(
        assets: [AssetElement]? = nil,
        createdAt: Date? = nil,
        policy: Policy? = nil,
        recorder: Recorder? = nil,
        revision: Int? = nil,
        schemaVersion: SchemaVersion? = nil,
        sessionID: String? = nil,
        state: AtriumCaptureSessionState? = nil,
        steps: [StepElement]? = nil,
        title: String? = nil,
        updatedAt: Date? = nil
    ) -> AtriumCaptureSession {
        return AtriumCaptureSession(
            assets: assets ?? self.assets,
            createdAt: createdAt ?? self.createdAt,
            policy: policy ?? self.policy,
            recorder: recorder ?? self.recorder,
            revision: revision ?? self.revision,
            schemaVersion: schemaVersion ?? self.schemaVersion,
            sessionID: sessionID ?? self.sessionID,
            state: state ?? self.state,
            steps: steps ?? self.steps,
            title: title ?? self.title,
            updatedAt: updatedAt ?? self.updatedAt
        )
    }

    func jsonData() throws -> Data {
        return try newJSONEncoder().encode(self)
    }

    func jsonString(encoding: String.Encoding = .utf8) throws -> String? {
        return String(data: try self.jsonData(), encoding: encoding)
    }
}

// MARK: - AssetElement
public struct AssetElement: Codable {
    public let annotations: [AnnotationElement]?
    public let assetID: String
    public let derivedFromAssetID: String?
    public let localKey: String
    public let mimeType: MIMEType
    public let pixelHeight: Int
    public let pixelWidth: Int
    public let sha256: String
    public let state: AssetState

    public enum CodingKeys: String, CodingKey {
        case annotations = "annotations"
        case assetID = "assetId"
        case derivedFromAssetID = "derivedFromAssetId"
        case localKey = "localKey"
        case mimeType = "mimeType"
        case pixelHeight = "pixelHeight"
        case pixelWidth = "pixelWidth"
        case sha256 = "sha256"
        case state = "state"
    }

    public init(annotations: [AnnotationElement]?, assetID: String, derivedFromAssetID: String?, localKey: String, mimeType: MIMEType, pixelHeight: Int, pixelWidth: Int, sha256: String, state: AssetState) {
        self.annotations = annotations
        self.assetID = assetID
        self.derivedFromAssetID = derivedFromAssetID
        self.localKey = localKey
        self.mimeType = mimeType
        self.pixelHeight = pixelHeight
        self.pixelWidth = pixelWidth
        self.sha256 = sha256
        self.state = state
    }
}

// MARK: AssetElement convenience initializers and mutators

public extension AssetElement {
    init(data: Data) throws {
        self = try newJSONDecoder().decode(AssetElement.self, from: data)
    }

    init(_ json: String, using encoding: String.Encoding = .utf8) throws {
        guard let data = json.data(using: encoding) else {
            throw NSError(domain: "JSONDecoding", code: 0, userInfo: nil)
        }
        try self.init(data: data)
    }

    init(fromURL url: URL) throws {
        try self.init(data: try Data(contentsOf: url))
    }

    func with(
        annotations: [AnnotationElement]?? = nil,
        assetID: String? = nil,
        derivedFromAssetID: String?? = nil,
        localKey: String? = nil,
        mimeType: MIMEType? = nil,
        pixelHeight: Int? = nil,
        pixelWidth: Int? = nil,
        sha256: String? = nil,
        state: AssetState? = nil
    ) -> AssetElement {
        return AssetElement(
            annotations: annotations ?? self.annotations,
            assetID: assetID ?? self.assetID,
            derivedFromAssetID: derivedFromAssetID ?? self.derivedFromAssetID,
            localKey: localKey ?? self.localKey,
            mimeType: mimeType ?? self.mimeType,
            pixelHeight: pixelHeight ?? self.pixelHeight,
            pixelWidth: pixelWidth ?? self.pixelWidth,
            sha256: sha256 ?? self.sha256,
            state: state ?? self.state
        )
    }

    func jsonData() throws -> Data {
        return try newJSONEncoder().encode(self)
    }

    func jsonString(encoding: String.Encoding = .utf8) throws -> String? {
        return String(data: try self.jsonData(), encoding: encoding)
    }
}

// MARK: - AnnotationElement
public struct AnnotationElement: Codable {
    public let arrowDirection: ArrowDirection?
    public let color: String?
    public let geometry: Geometry
    public let id: String
    public let kind: Kind
    public let text: String?

    public enum CodingKeys: String, CodingKey {
        case arrowDirection = "arrowDirection"
        case color = "color"
        case geometry = "geometry"
        case id = "id"
        case kind = "kind"
        case text = "text"
    }

    public init(arrowDirection: ArrowDirection?, color: String?, geometry: Geometry, id: String, kind: Kind, text: String?) {
        self.arrowDirection = arrowDirection
        self.color = color
        self.geometry = geometry
        self.id = id
        self.kind = kind
        self.text = text
    }
}

// MARK: AnnotationElement convenience initializers and mutators

public extension AnnotationElement {
    init(data: Data) throws {
        self = try newJSONDecoder().decode(AnnotationElement.self, from: data)
    }

    init(_ json: String, using encoding: String.Encoding = .utf8) throws {
        guard let data = json.data(using: encoding) else {
            throw NSError(domain: "JSONDecoding", code: 0, userInfo: nil)
        }
        try self.init(data: data)
    }

    init(fromURL url: URL) throws {
        try self.init(data: try Data(contentsOf: url))
    }

    func with(
        arrowDirection: ArrowDirection?? = nil,
        color: String?? = nil,
        geometry: Geometry? = nil,
        id: String? = nil,
        kind: Kind? = nil,
        text: String?? = nil
    ) -> AnnotationElement {
        return AnnotationElement(
            arrowDirection: arrowDirection ?? self.arrowDirection,
            color: color ?? self.color,
            geometry: geometry ?? self.geometry,
            id: id ?? self.id,
            kind: kind ?? self.kind,
            text: text ?? self.text
        )
    }

    func jsonData() throws -> Data {
        return try newJSONEncoder().encode(self)
    }

    func jsonString(encoding: String.Encoding = .utf8) throws -> String? {
        return String(data: try self.jsonData(), encoding: encoding)
    }
}

public enum ArrowDirection: String, Codable {
    case downLeft = "down_left"
    case downRight = "down_right"
    case upLeft = "up_left"
    case upRight = "up_right"
}

// MARK: - Geometry
public struct Geometry: Codable {
    public let height: Double
    public let width: Double
    public let x: Double
    public let y: Double

    public enum CodingKeys: String, CodingKey {
        case height = "height"
        case width = "width"
        case x = "x"
        case y = "y"
    }

    public init(height: Double, width: Double, x: Double, y: Double) {
        self.height = height
        self.width = width
        self.x = x
        self.y = y
    }
}

// MARK: Geometry convenience initializers and mutators

public extension Geometry {
    init(data: Data) throws {
        self = try newJSONDecoder().decode(Geometry.self, from: data)
    }

    init(_ json: String, using encoding: String.Encoding = .utf8) throws {
        guard let data = json.data(using: encoding) else {
            throw NSError(domain: "JSONDecoding", code: 0, userInfo: nil)
        }
        try self.init(data: data)
    }

    init(fromURL url: URL) throws {
        try self.init(data: try Data(contentsOf: url))
    }

    func with(
        height: Double? = nil,
        width: Double? = nil,
        x: Double? = nil,
        y: Double? = nil
    ) -> Geometry {
        return Geometry(
            height: height ?? self.height,
            width: width ?? self.width,
            x: x ?? self.x,
            y: y ?? self.y
        )
    }

    func jsonData() throws -> Data {
        return try newJSONEncoder().encode(self)
    }

    func jsonString(encoding: String.Encoding = .utf8) throws -> String? {
        return String(data: try self.jsonData(), encoding: encoding)
    }
}

public enum Kind: String, Codable {
    case arrow = "arrow"
    case blur = "blur"
    case highlight = "highlight"
    case mosaic = "mosaic"
    case rectangle = "rectangle"
    case redaction = "redaction"
    case text = "text"
}

public enum MIMEType: String, Codable {
    case imageJPEG = "image/jpeg"
    case imagePNG = "image/png"
    case imageWebp = "image/webp"
}

public enum AssetState: String, Codable {
    case deleted = "deleted"
    case publishableLocal = "publishable_local"
    case rawLocal = "raw_local"
    case redactedLocal = "redacted_local"
    case uploaded = "uploaded"
}

// MARK: - Policy
public struct Policy: Codable {
    public let denyReason: String?
    public let policyVersion: String
    public let rawImageRetention: RawImageRetention?
    public let reviewStatus: ReviewStatus
    public let sourceURLRetention: SourceURLRetention

    public enum CodingKeys: String, CodingKey {
        case denyReason = "denyReason"
        case policyVersion = "policyVersion"
        case rawImageRetention = "rawImageRetention"
        case reviewStatus = "reviewStatus"
        case sourceURLRetention = "sourceUrlRetention"
    }

    public init(denyReason: String?, policyVersion: String, rawImageRetention: RawImageRetention?, reviewStatus: ReviewStatus, sourceURLRetention: SourceURLRetention) {
        self.denyReason = denyReason
        self.policyVersion = policyVersion
        self.rawImageRetention = rawImageRetention
        self.reviewStatus = reviewStatus
        self.sourceURLRetention = sourceURLRetention
    }
}

// MARK: Policy convenience initializers and mutators

public extension Policy {
    init(data: Data) throws {
        self = try newJSONDecoder().decode(Policy.self, from: data)
    }

    init(_ json: String, using encoding: String.Encoding = .utf8) throws {
        guard let data = json.data(using: encoding) else {
            throw NSError(domain: "JSONDecoding", code: 0, userInfo: nil)
        }
        try self.init(data: data)
    }

    init(fromURL url: URL) throws {
        try self.init(data: try Data(contentsOf: url))
    }

    func with(
        denyReason: String?? = nil,
        policyVersion: String? = nil,
        rawImageRetention: RawImageRetention?? = nil,
        reviewStatus: ReviewStatus? = nil,
        sourceURLRetention: SourceURLRetention? = nil
    ) -> Policy {
        return Policy(
            denyReason: denyReason ?? self.denyReason,
            policyVersion: policyVersion ?? self.policyVersion,
            rawImageRetention: rawImageRetention ?? self.rawImageRetention,
            reviewStatus: reviewStatus ?? self.reviewStatus,
            sourceURLRetention: sourceURLRetention ?? self.sourceURLRetention
        )
    }

    func jsonData() throws -> Data {
        return try newJSONEncoder().encode(self)
    }

    func jsonString(encoding: String.Encoding = .utf8) throws -> String? {
        return String(data: try self.jsonData(), encoding: encoding)
    }
}

public enum RawImageRetention: String, Codable {
    case deleteAfterFlatten = "delete_after_flatten"
    case deleteAfterSubmit = "delete_after_submit"
}

public enum ReviewStatus: String, Codable {
    case approved = "approved"
    case inReview = "in_review"
    case notReviewed = "not_reviewed"
}

public enum SourceURLRetention: String, Codable {
    case full = "full"
    case none = "none"
    case origin = "origin"
}

// MARK: - Recorder
public struct Recorder: Codable {
    public let appVersion: String
    public let browserName: String?
    public let browserVersion: String?
    public let osVersion: String?
    public let surface: Surface

    public enum CodingKeys: String, CodingKey {
        case appVersion = "appVersion"
        case browserName = "browserName"
        case browserVersion = "browserVersion"
        case osVersion = "osVersion"
        case surface = "surface"
    }

    public init(appVersion: String, browserName: String?, browserVersion: String?, osVersion: String?, surface: Surface) {
        self.appVersion = appVersion
        self.browserName = browserName
        self.browserVersion = browserVersion
        self.osVersion = osVersion
        self.surface = surface
    }
}

// MARK: Recorder convenience initializers and mutators

public extension Recorder {
    init(data: Data) throws {
        self = try newJSONDecoder().decode(Recorder.self, from: data)
    }

    init(_ json: String, using encoding: String.Encoding = .utf8) throws {
        guard let data = json.data(using: encoding) else {
            throw NSError(domain: "JSONDecoding", code: 0, userInfo: nil)
        }
        try self.init(data: data)
    }

    init(fromURL url: URL) throws {
        try self.init(data: try Data(contentsOf: url))
    }

    func with(
        appVersion: String? = nil,
        browserName: String?? = nil,
        browserVersion: String?? = nil,
        osVersion: String?? = nil,
        surface: Surface? = nil
    ) -> Recorder {
        return Recorder(
            appVersion: appVersion ?? self.appVersion,
            browserName: browserName ?? self.browserName,
            browserVersion: browserVersion ?? self.browserVersion,
            osVersion: osVersion ?? self.osVersion,
            surface: surface ?? self.surface
        )
    }

    func jsonData() throws -> Data {
        return try newJSONEncoder().encode(self)
    }

    func jsonString(encoding: String.Encoding = .utf8) throws -> String? {
        return String(data: try self.jsonData(), encoding: encoding)
    }
}

public enum Surface: String, Codable {
    case browser = "browser"
    case hybrid = "hybrid"
    case macos = "macos"
}

public enum SchemaVersion: String, Codable {
    case the10 = "1.0"
}

public enum AtriumCaptureSessionState: String, Codable {
    case archived = "archived"
    case paused = "paused"
    case publishable = "publishable"
    case recording = "recording"
    case review = "review"
    case submitted = "submitted"
}

// MARK: - StepElement
public struct StepElement: Codable {
    public let action: Action
    public let annotations: [AnnotationElement]?
    public let crop: Geometry?
    public let instruction: Instruction
    public let occurredAt: Date
    public let privacyReview: PrivacyReview
    public let screenshotAssetID: String?
    public let sequence: Int
    public let stepID: String
    public let target: Target?

    public enum CodingKeys: String, CodingKey {
        case action = "action"
        case annotations = "annotations"
        case crop = "crop"
        case instruction = "instruction"
        case occurredAt = "occurredAt"
        case privacyReview = "privacyReview"
        case screenshotAssetID = "screenshotAssetId"
        case sequence = "sequence"
        case stepID = "stepId"
        case target = "target"
    }

    public init(action: Action, annotations: [AnnotationElement]?, crop: Geometry?, instruction: Instruction, occurredAt: Date, privacyReview: PrivacyReview, screenshotAssetID: String?, sequence: Int, stepID: String, target: Target?) {
        self.action = action
        self.annotations = annotations
        self.crop = crop
        self.instruction = instruction
        self.occurredAt = occurredAt
        self.privacyReview = privacyReview
        self.screenshotAssetID = screenshotAssetID
        self.sequence = sequence
        self.stepID = stepID
        self.target = target
    }
}

// MARK: StepElement convenience initializers and mutators

public extension StepElement {
    init(data: Data) throws {
        self = try newJSONDecoder().decode(StepElement.self, from: data)
    }

    init(_ json: String, using encoding: String.Encoding = .utf8) throws {
        guard let data = json.data(using: encoding) else {
            throw NSError(domain: "JSONDecoding", code: 0, userInfo: nil)
        }
        try self.init(data: data)
    }

    init(fromURL url: URL) throws {
        try self.init(data: try Data(contentsOf: url))
    }

    func with(
        action: Action? = nil,
        annotations: [AnnotationElement]?? = nil,
        crop: Geometry?? = nil,
        instruction: Instruction? = nil,
        occurredAt: Date? = nil,
        privacyReview: PrivacyReview? = nil,
        screenshotAssetID: String?? = nil,
        sequence: Int? = nil,
        stepID: String? = nil,
        target: Target?? = nil
    ) -> StepElement {
        return StepElement(
            action: action ?? self.action,
            annotations: annotations ?? self.annotations,
            crop: crop ?? self.crop,
            instruction: instruction ?? self.instruction,
            occurredAt: occurredAt ?? self.occurredAt,
            privacyReview: privacyReview ?? self.privacyReview,
            screenshotAssetID: screenshotAssetID ?? self.screenshotAssetID,
            sequence: sequence ?? self.sequence,
            stepID: stepID ?? self.stepID,
            target: target ?? self.target
        )
    }

    func jsonData() throws -> Data {
        return try newJSONEncoder().encode(self)
    }

    func jsonString(encoding: String.Encoding = .utf8) throws -> String? {
        return String(data: try self.jsonData(), encoding: encoding)
    }
}

public enum Action: String, Codable {
    case click = "click"
    case drag = "drag"
    case input = "input"
    case manual = "manual"
    case navigate = "navigate"
    case scroll = "scroll"
    case select = "select"
    case shortcut = "shortcut"
    case submit = "submit"
}

// MARK: - Instruction
public struct Instruction: Codable {
    public let editedText: String?
    public let generatedText: String
    public let source: Source
    public let userEdited: Bool

    public enum CodingKeys: String, CodingKey {
        case editedText = "editedText"
        case generatedText = "generatedText"
        case source = "source"
        case userEdited = "userEdited"
    }

    public init(editedText: String?, generatedText: String, source: Source, userEdited: Bool) {
        self.editedText = editedText
        self.generatedText = generatedText
        self.source = source
        self.userEdited = userEdited
    }
}

// MARK: Instruction convenience initializers and mutators

public extension Instruction {
    init(data: Data) throws {
        self = try newJSONDecoder().decode(Instruction.self, from: data)
    }

    init(_ json: String, using encoding: String.Encoding = .utf8) throws {
        guard let data = json.data(using: encoding) else {
            throw NSError(domain: "JSONDecoding", code: 0, userInfo: nil)
        }
        try self.init(data: data)
    }

    init(fromURL url: URL) throws {
        try self.init(data: try Data(contentsOf: url))
    }

    func with(
        editedText: String?? = nil,
        generatedText: String? = nil,
        source: Source? = nil,
        userEdited: Bool? = nil
    ) -> Instruction {
        return Instruction(
            editedText: editedText ?? self.editedText,
            generatedText: generatedText ?? self.generatedText,
            source: source ?? self.source,
            userEdited: userEdited ?? self.userEdited
        )
    }

    func jsonData() throws -> Data {
        return try newJSONEncoder().encode(self)
    }

    func jsonString(encoding: String.Encoding = .utf8) throws -> String? {
        return String(data: try self.jsonData(), encoding: encoding)
    }
}

public enum Source: String, Codable {
    case districtAI = "district_ai"
    case rules = "rules"
    case user = "user"
}

public enum PrivacyReview: String, Codable {
    case approved = "approved"
    case flagged = "flagged"
    case notReviewed = "not_reviewed"
}

// MARK: - Target
public struct Target: Codable {
    public let accessibleName: String?
    public let bounds: Geometry?
    public let browser: Browser?
    public let macos: Macos?
    public let role: String?

    public enum CodingKeys: String, CodingKey {
        case accessibleName = "accessibleName"
        case bounds = "bounds"
        case browser = "browser"
        case macos = "macos"
        case role = "role"
    }

    public init(accessibleName: String?, bounds: Geometry?, browser: Browser?, macos: Macos?, role: String?) {
        self.accessibleName = accessibleName
        self.bounds = bounds
        self.browser = browser
        self.macos = macos
        self.role = role
    }
}

// MARK: Target convenience initializers and mutators

public extension Target {
    init(data: Data) throws {
        self = try newJSONDecoder().decode(Target.self, from: data)
    }

    init(_ json: String, using encoding: String.Encoding = .utf8) throws {
        guard let data = json.data(using: encoding) else {
            throw NSError(domain: "JSONDecoding", code: 0, userInfo: nil)
        }
        try self.init(data: data)
    }

    init(fromURL url: URL) throws {
        try self.init(data: try Data(contentsOf: url))
    }

    func with(
        accessibleName: String?? = nil,
        bounds: Geometry?? = nil,
        browser: Browser?? = nil,
        macos: Macos?? = nil,
        role: String?? = nil
    ) -> Target {
        return Target(
            accessibleName: accessibleName ?? self.accessibleName,
            bounds: bounds ?? self.bounds,
            browser: browser ?? self.browser,
            macos: macos ?? self.macos,
            role: role ?? self.role
        )
    }

    func jsonData() throws -> Data {
        return try newJSONEncoder().encode(self)
    }

    func jsonString(encoding: String.Encoding = .utf8) throws -> String? {
        return String(data: try self.jsonData(), encoding: encoding)
    }
}

// MARK: - Browser
public struct Browser: Codable {
    public let devicePixelRatio: Double
    public let origin: String
    public let pageTitle: String?
    public let path: String?
    public let selectors: [String]?
    public let viewportCSS: ViewportCSS

    public enum CodingKeys: String, CodingKey {
        case devicePixelRatio = "devicePixelRatio"
        case origin = "origin"
        case pageTitle = "pageTitle"
        case path = "path"
        case selectors = "selectors"
        case viewportCSS = "viewportCss"
    }

    public init(devicePixelRatio: Double, origin: String, pageTitle: String?, path: String?, selectors: [String]?, viewportCSS: ViewportCSS) {
        self.devicePixelRatio = devicePixelRatio
        self.origin = origin
        self.pageTitle = pageTitle
        self.path = path
        self.selectors = selectors
        self.viewportCSS = viewportCSS
    }
}

// MARK: Browser convenience initializers and mutators

public extension Browser {
    init(data: Data) throws {
        self = try newJSONDecoder().decode(Browser.self, from: data)
    }

    init(_ json: String, using encoding: String.Encoding = .utf8) throws {
        guard let data = json.data(using: encoding) else {
            throw NSError(domain: "JSONDecoding", code: 0, userInfo: nil)
        }
        try self.init(data: data)
    }

    init(fromURL url: URL) throws {
        try self.init(data: try Data(contentsOf: url))
    }

    func with(
        devicePixelRatio: Double? = nil,
        origin: String? = nil,
        pageTitle: String?? = nil,
        path: String?? = nil,
        selectors: [String]?? = nil,
        viewportCSS: ViewportCSS? = nil
    ) -> Browser {
        return Browser(
            devicePixelRatio: devicePixelRatio ?? self.devicePixelRatio,
            origin: origin ?? self.origin,
            pageTitle: pageTitle ?? self.pageTitle,
            path: path ?? self.path,
            selectors: selectors ?? self.selectors,
            viewportCSS: viewportCSS ?? self.viewportCSS
        )
    }

    func jsonData() throws -> Data {
        return try newJSONEncoder().encode(self)
    }

    func jsonString(encoding: String.Encoding = .utf8) throws -> String? {
        return String(data: try self.jsonData(), encoding: encoding)
    }
}

// MARK: - ViewportCSS
public struct ViewportCSS: Codable {
    public let height: Double
    public let width: Double

    public enum CodingKeys: String, CodingKey {
        case height = "height"
        case width = "width"
    }

    public init(height: Double, width: Double) {
        self.height = height
        self.width = width
    }
}

// MARK: ViewportCSS convenience initializers and mutators

public extension ViewportCSS {
    init(data: Data) throws {
        self = try newJSONDecoder().decode(ViewportCSS.self, from: data)
    }

    init(_ json: String, using encoding: String.Encoding = .utf8) throws {
        guard let data = json.data(using: encoding) else {
            throw NSError(domain: "JSONDecoding", code: 0, userInfo: nil)
        }
        try self.init(data: data)
    }

    init(fromURL url: URL) throws {
        try self.init(data: try Data(contentsOf: url))
    }

    func with(
        height: Double? = nil,
        width: Double? = nil
    ) -> ViewportCSS {
        return ViewportCSS(
            height: height ?? self.height,
            width: width ?? self.width
        )
    }

    func jsonData() throws -> Data {
        return try newJSONEncoder().encode(self)
    }

    func jsonString(encoding: String.Encoding = .utf8) throws -> String? {
        return String(data: try self.jsonData(), encoding: encoding)
    }
}

// MARK: - Macos
public struct Macos: Codable {
    public let accessibilityRole: String?
    public let appName: String
    public let backingScaleFactor: Double
    public let bundleID: String
    public let windowTitle: String?

    public enum CodingKeys: String, CodingKey {
        case accessibilityRole = "accessibilityRole"
        case appName = "appName"
        case backingScaleFactor = "backingScaleFactor"
        case bundleID = "bundleId"
        case windowTitle = "windowTitle"
    }

    public init(accessibilityRole: String?, appName: String, backingScaleFactor: Double, bundleID: String, windowTitle: String?) {
        self.accessibilityRole = accessibilityRole
        self.appName = appName
        self.backingScaleFactor = backingScaleFactor
        self.bundleID = bundleID
        self.windowTitle = windowTitle
    }
}

// MARK: Macos convenience initializers and mutators

public extension Macos {
    init(data: Data) throws {
        self = try newJSONDecoder().decode(Macos.self, from: data)
    }

    init(_ json: String, using encoding: String.Encoding = .utf8) throws {
        guard let data = json.data(using: encoding) else {
            throw NSError(domain: "JSONDecoding", code: 0, userInfo: nil)
        }
        try self.init(data: data)
    }

    init(fromURL url: URL) throws {
        try self.init(data: try Data(contentsOf: url))
    }

    func with(
        accessibilityRole: String?? = nil,
        appName: String? = nil,
        backingScaleFactor: Double? = nil,
        bundleID: String? = nil,
        windowTitle: String?? = nil
    ) -> Macos {
        return Macos(
            accessibilityRole: accessibilityRole ?? self.accessibilityRole,
            appName: appName ?? self.appName,
            backingScaleFactor: backingScaleFactor ?? self.backingScaleFactor,
            bundleID: bundleID ?? self.bundleID,
            windowTitle: windowTitle ?? self.windowTitle
        )
    }

    func jsonData() throws -> Data {
        return try newJSONEncoder().encode(self)
    }

    func jsonString(encoding: String.Encoding = .utf8) throws -> String? {
        return String(data: try self.jsonData(), encoding: encoding)
    }
}

// MARK: - AtriumCaptureNativeBridgeMessage
public struct AtriumCaptureNativeBridgeMessage: Codable {
    public let correlationID: String?
    public let messageID: String
    /// Semantic/control metadata only. Screenshot bytes and bearer tokens are prohibited.
    public let payload: [String: JSONAny]
    public let protocolVersion: Double
    public let sentAt: Date
    public let type: TypeEnum

    public enum CodingKeys: String, CodingKey {
        case correlationID = "correlationId"
        case messageID = "messageId"
        case payload = "payload"
        case protocolVersion = "protocolVersion"
        case sentAt = "sentAt"
        case type = "type"
    }

    public init(correlationID: String?, messageID: String, payload: [String: JSONAny], protocolVersion: Double, sentAt: Date, type: TypeEnum) {
        self.correlationID = correlationID
        self.messageID = messageID
        self.payload = payload
        self.protocolVersion = protocolVersion
        self.sentAt = sentAt
        self.type = type
    }
}

// MARK: AtriumCaptureNativeBridgeMessage convenience initializers and mutators

public extension AtriumCaptureNativeBridgeMessage {
    init(data: Data) throws {
        self = try newJSONDecoder().decode(AtriumCaptureNativeBridgeMessage.self, from: data)
    }

    init(_ json: String, using encoding: String.Encoding = .utf8) throws {
        guard let data = json.data(using: encoding) else {
            throw NSError(domain: "JSONDecoding", code: 0, userInfo: nil)
        }
        try self.init(data: data)
    }

    init(fromURL url: URL) throws {
        try self.init(data: try Data(contentsOf: url))
    }

    func with(
        correlationID: String?? = nil,
        messageID: String? = nil,
        payload: [String: JSONAny]? = nil,
        protocolVersion: Double? = nil,
        sentAt: Date? = nil,
        type: TypeEnum? = nil
    ) -> AtriumCaptureNativeBridgeMessage {
        return AtriumCaptureNativeBridgeMessage(
            correlationID: correlationID ?? self.correlationID,
            messageID: messageID ?? self.messageID,
            payload: payload ?? self.payload,
            protocolVersion: protocolVersion ?? self.protocolVersion,
            sentAt: sentAt ?? self.sentAt,
            type: type ?? self.type
        )
    }

    func jsonData() throws -> Data {
        return try newJSONEncoder().encode(self)
    }

    func jsonString(encoding: String.Encoding = .utf8) throws -> String? {
        return String(data: try self.jsonData(), encoding: encoding)
    }
}

public enum TypeEnum: String, Codable {
    case domStep = "dom_step"
    case error = "error"
    case hello = "hello"
    case helloACK = "hello_ack"
    case pauseSession = "pause_session"
    case resumeSession = "resume_session"
    case sessionState = "session_state"
    case startSession = "start_session"
    case stopSession = "stop_session"
}

// MARK: - AtriumCapturePublishJob
public struct AtriumCapturePublishJob: Codable {
    public let assetUploads: [AssetUpload]?
    public let attemptCount: Int
    public let collectionID: String?
    public let contentObjectID: String?
    public let createdAt: Date
    public let createIdempotencyKey: String
    public let createTitle: String?
    public let currentVersionID: String?
    public let jobID: String
    public let lastError: LastError?
    public let phase: Phase
    public let readerURL: String?
    public let remoteTitle: String?
    public let schemaVersion: SchemaVersion
    public let sessionID: String
    public let updatedAt: Date

    public enum CodingKeys: String, CodingKey {
        case assetUploads = "assetUploads"
        case attemptCount = "attemptCount"
        case collectionID = "collectionId"
        case contentObjectID = "contentObjectId"
        case createdAt = "createdAt"
        case createIdempotencyKey = "createIdempotencyKey"
        case createTitle = "createTitle"
        case currentVersionID = "currentVersionId"
        case jobID = "jobId"
        case lastError = "lastError"
        case phase = "phase"
        case readerURL = "readerUrl"
        case remoteTitle = "remoteTitle"
        case schemaVersion = "schemaVersion"
        case sessionID = "sessionId"
        case updatedAt = "updatedAt"
    }

    public init(assetUploads: [AssetUpload]?, attemptCount: Int, collectionID: String?, contentObjectID: String?, createdAt: Date, createIdempotencyKey: String, createTitle: String?, currentVersionID: String?, jobID: String, lastError: LastError?, phase: Phase, readerURL: String?, remoteTitle: String?, schemaVersion: SchemaVersion, sessionID: String, updatedAt: Date) {
        self.assetUploads = assetUploads
        self.attemptCount = attemptCount
        self.collectionID = collectionID
        self.contentObjectID = contentObjectID
        self.createdAt = createdAt
        self.createIdempotencyKey = createIdempotencyKey
        self.createTitle = createTitle
        self.currentVersionID = currentVersionID
        self.jobID = jobID
        self.lastError = lastError
        self.phase = phase
        self.readerURL = readerURL
        self.remoteTitle = remoteTitle
        self.schemaVersion = schemaVersion
        self.sessionID = sessionID
        self.updatedAt = updatedAt
    }
}

// MARK: AtriumCapturePublishJob convenience initializers and mutators

public extension AtriumCapturePublishJob {
    init(data: Data) throws {
        self = try newJSONDecoder().decode(AtriumCapturePublishJob.self, from: data)
    }

    init(_ json: String, using encoding: String.Encoding = .utf8) throws {
        guard let data = json.data(using: encoding) else {
            throw NSError(domain: "JSONDecoding", code: 0, userInfo: nil)
        }
        try self.init(data: data)
    }

    init(fromURL url: URL) throws {
        try self.init(data: try Data(contentsOf: url))
    }

    func with(
        assetUploads: [AssetUpload]?? = nil,
        attemptCount: Int? = nil,
        collectionID: String?? = nil,
        contentObjectID: String?? = nil,
        createdAt: Date? = nil,
        createIdempotencyKey: String? = nil,
        createTitle: String?? = nil,
        currentVersionID: String?? = nil,
        jobID: String? = nil,
        lastError: LastError?? = nil,
        phase: Phase? = nil,
        readerURL: String?? = nil,
        remoteTitle: String?? = nil,
        schemaVersion: SchemaVersion? = nil,
        sessionID: String? = nil,
        updatedAt: Date? = nil
    ) -> AtriumCapturePublishJob {
        return AtriumCapturePublishJob(
            assetUploads: assetUploads ?? self.assetUploads,
            attemptCount: attemptCount ?? self.attemptCount,
            collectionID: collectionID ?? self.collectionID,
            contentObjectID: contentObjectID ?? self.contentObjectID,
            createdAt: createdAt ?? self.createdAt,
            createIdempotencyKey: createIdempotencyKey ?? self.createIdempotencyKey,
            createTitle: createTitle ?? self.createTitle,
            currentVersionID: currentVersionID ?? self.currentVersionID,
            jobID: jobID ?? self.jobID,
            lastError: lastError ?? self.lastError,
            phase: phase ?? self.phase,
            readerURL: readerURL ?? self.readerURL,
            remoteTitle: remoteTitle ?? self.remoteTitle,
            schemaVersion: schemaVersion ?? self.schemaVersion,
            sessionID: sessionID ?? self.sessionID,
            updatedAt: updatedAt ?? self.updatedAt
        )
    }

    func jsonData() throws -> Data {
        return try newJSONEncoder().encode(self)
    }

    func jsonString(encoding: String.Encoding = .utf8) throws -> String? {
        return String(data: try self.jsonData(), encoding: encoding)
    }
}

// MARK: - AssetUpload
public struct AssetUpload: Codable {
    public let idempotencyKey: String
    public let localAssetID: String
    public let remoteAssetID: String?
    public let state: AssetUploadState

    public enum CodingKeys: String, CodingKey {
        case idempotencyKey = "idempotencyKey"
        case localAssetID = "localAssetId"
        case remoteAssetID = "remoteAssetId"
        case state = "state"
    }

    public init(idempotencyKey: String, localAssetID: String, remoteAssetID: String?, state: AssetUploadState) {
        self.idempotencyKey = idempotencyKey
        self.localAssetID = localAssetID
        self.remoteAssetID = remoteAssetID
        self.state = state
    }
}

// MARK: AssetUpload convenience initializers and mutators

public extension AssetUpload {
    init(data: Data) throws {
        self = try newJSONDecoder().decode(AssetUpload.self, from: data)
    }

    init(_ json: String, using encoding: String.Encoding = .utf8) throws {
        guard let data = json.data(using: encoding) else {
            throw NSError(domain: "JSONDecoding", code: 0, userInfo: nil)
        }
        try self.init(data: data)
    }

    init(fromURL url: URL) throws {
        try self.init(data: try Data(contentsOf: url))
    }

    func with(
        idempotencyKey: String? = nil,
        localAssetID: String? = nil,
        remoteAssetID: String?? = nil,
        state: AssetUploadState? = nil
    ) -> AssetUpload {
        return AssetUpload(
            idempotencyKey: idempotencyKey ?? self.idempotencyKey,
            localAssetID: localAssetID ?? self.localAssetID,
            remoteAssetID: remoteAssetID ?? self.remoteAssetID,
            state: state ?? self.state
        )
    }

    func jsonData() throws -> Data {
        return try newJSONEncoder().encode(self)
    }

    func jsonString(encoding: String.Encoding = .utf8) throws -> String? {
        return String(data: try self.jsonData(), encoding: encoding)
    }
}

public enum AssetUploadState: String, Codable {
    case failed = "failed"
    case pending = "pending"
    case processing = "processing"
    case ready = "ready"
    case uploading = "uploading"
}

// MARK: - LastError
public struct LastError: Codable {
    public let code: String
    public let message: String
    public let requestID: String?
    public let retryable: Bool

    public enum CodingKeys: String, CodingKey {
        case code = "code"
        case message = "message"
        case requestID = "requestId"
        case retryable = "retryable"
    }

    public init(code: String, message: String, requestID: String?, retryable: Bool) {
        self.code = code
        self.message = message
        self.requestID = requestID
        self.retryable = retryable
    }
}

// MARK: LastError convenience initializers and mutators

public extension LastError {
    init(data: Data) throws {
        self = try newJSONDecoder().decode(LastError.self, from: data)
    }

    init(_ json: String, using encoding: String.Encoding = .utf8) throws {
        guard let data = json.data(using: encoding) else {
            throw NSError(domain: "JSONDecoding", code: 0, userInfo: nil)
        }
        try self.init(data: data)
    }

    init(fromURL url: URL) throws {
        try self.init(data: try Data(contentsOf: url))
    }

    func with(
        code: String? = nil,
        message: String? = nil,
        requestID: String?? = nil,
        retryable: Bool? = nil
    ) -> LastError {
        return LastError(
            code: code ?? self.code,
            message: message ?? self.message,
            requestID: requestID ?? self.requestID,
            retryable: retryable ?? self.retryable
        )
    }

    func jsonData() throws -> Data {
        return try newJSONEncoder().encode(self)
    }

    func jsonString(encoding: String.Encoding = .utf8) throws -> String? {
        return String(data: try self.jsonData(), encoding: encoding)
    }
}

public enum Phase: String, Codable {
    case complete = "complete"
    case creatingObject = "creating_object"
    case creatingVersion = "creating_version"
    case needsAttention = "needs_attention"
    case publishingInternal = "publishing_internal"
    case queued = "queued"
    case readyAsDraft = "ready_as_draft"
    case uploadingAssets = "uploading_assets"
}

// MARK: - Helper functions for creating encoders and decoders

func newJSONDecoder() -> JSONDecoder {
    AtriumContractCodec.makeDecoder()
}

func newJSONEncoder() -> JSONEncoder {
    AtriumContractCodec.makeEncoder()
}

// MARK: - Encode/decode helpers

public class JSONNull: Codable, Hashable {

    public static func == (lhs: JSONNull, rhs: JSONNull) -> Bool {
        return true
    }

    public var hashValue: Int {
        return 0
    }

    public func hash(into hasher: inout Hasher) {
        // No-op
    }

    public init() {}

    public required init(from decoder: Decoder) throws {
        let container = try decoder.singleValueContainer()
        if !container.decodeNil() {
            throw DecodingError.typeMismatch(JSONNull.self, DecodingError.Context(codingPath: decoder.codingPath, debugDescription: "Wrong type for JSONNull"))
        }
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.singleValueContainer()
        try container.encodeNil()
    }
}

final class JSONCodingKey: CodingKey {
    let key: String

    required init?(intValue: Int) {
        return nil
    }

    required init?(stringValue: String) {
        key = stringValue
    }

    var intValue: Int? {
        return nil
    }

    var stringValue: String {
        return key
    }
}

public class JSONAny: Codable {

    public let value: Any

    static func decodingError(forCodingPath codingPath: [CodingKey]) -> DecodingError {
        let context = DecodingError.Context(codingPath: codingPath, debugDescription: "Cannot decode JSONAny")
        return DecodingError.typeMismatch(JSONAny.self, context)
    }

    static func encodingError(forValue value: Any, codingPath: [CodingKey]) -> EncodingError {
        let context = EncodingError.Context(codingPath: codingPath, debugDescription: "Cannot encode JSONAny")
        return EncodingError.invalidValue(value, context)
    }

    static func decode(from container: SingleValueDecodingContainer) throws -> Any {
        if let value = try? container.decode(Bool.self) {
            return value
        }
        if let value = try? container.decode(Int64.self) {
            return value
        }
        if let value = try? container.decode(Double.self) {
            return value
        }
        if let value = try? container.decode(String.self) {
            return value
        }
        if container.decodeNil() {
            return JSONNull()
        }
        throw decodingError(forCodingPath: container.codingPath)
    }

    static func decode(from container: inout UnkeyedDecodingContainer) throws -> Any {
        if let value = try? container.decode(Bool.self) {
            return value
        }
        if let value = try? container.decode(Int64.self) {
            return value
        }
        if let value = try? container.decode(Double.self) {
            return value
        }
        if let value = try? container.decode(String.self) {
            return value
        }
        if let value = try? container.decodeNil() {
            if value {
                return JSONNull()
            }
        }
        if var container = try? container.nestedUnkeyedContainer() {
            return try decodeArray(from: &container)
        }
        if var container = try? container.nestedContainer(keyedBy: JSONCodingKey.self) {
            return try decodeDictionary(from: &container)
        }
        throw decodingError(forCodingPath: container.codingPath)
    }

    static func decode(from container: inout KeyedDecodingContainer<JSONCodingKey>, forKey key: JSONCodingKey) throws -> Any {
        if let value = try? container.decode(Bool.self, forKey: key) {
            return value
        }
        if let value = try? container.decode(Int64.self, forKey: key) {
            return value
        }
        if let value = try? container.decode(Double.self, forKey: key) {
            return value
        }
        if let value = try? container.decode(String.self, forKey: key) {
            return value
        }
        if let value = try? container.decodeNil(forKey: key) {
            if value {
                return JSONNull()
            }
        }
        if var container = try? container.nestedUnkeyedContainer(forKey: key) {
            return try decodeArray(from: &container)
        }
        if var container = try? container.nestedContainer(keyedBy: JSONCodingKey.self, forKey: key) {
            return try decodeDictionary(from: &container)
        }
        throw decodingError(forCodingPath: container.codingPath)
    }

    static func decodeArray(from container: inout UnkeyedDecodingContainer) throws -> [Any] {
        var arr: [Any] = []
        while !container.isAtEnd {
            let value = try decode(from: &container)
            arr.append(value)
        }
        return arr
    }

    static func decodeDictionary(from container: inout KeyedDecodingContainer<JSONCodingKey>) throws -> [String: Any] {
        var dict = [String: Any]()
        for key in container.allKeys {
            let value = try decode(from: &container, forKey: key)
            dict[key.stringValue] = value
        }
        return dict
    }

    static func encode(to container: inout UnkeyedEncodingContainer, array: [Any]) throws {
        for value in array {
            if let value = value as? Bool {
                try container.encode(value)
            } else if let value = value as? Int64 {
                try container.encode(value)
            } else if let value = value as? Double {
                try container.encode(value)
            } else if let value = value as? String {
                try container.encode(value)
            } else if value is JSONNull {
                try container.encodeNil()
            } else if let value = value as? [Any] {
                var container = container.nestedUnkeyedContainer()
                try encode(to: &container, array: value)
            } else if let value = value as? [String: Any] {
                var container = container.nestedContainer(keyedBy: JSONCodingKey.self)
                try encode(to: &container, dictionary: value)
            } else {
                throw encodingError(forValue: value, codingPath: container.codingPath)
            }
        }
    }

    static func encode(to container: inout KeyedEncodingContainer<JSONCodingKey>, dictionary: [String: Any]) throws {
        for (key, value) in dictionary {
            let key = JSONCodingKey(stringValue: key)!
            if let value = value as? Bool {
                try container.encode(value, forKey: key)
            } else if let value = value as? Int64 {
                try container.encode(value, forKey: key)
            } else if let value = value as? Double {
                try container.encode(value, forKey: key)
            } else if let value = value as? String {
                try container.encode(value, forKey: key)
            } else if value is JSONNull {
                try container.encodeNil(forKey: key)
            } else if let value = value as? [Any] {
                var container = container.nestedUnkeyedContainer(forKey: key)
                try encode(to: &container, array: value)
            } else if let value = value as? [String: Any] {
                var container = container.nestedContainer(keyedBy: JSONCodingKey.self, forKey: key)
                try encode(to: &container, dictionary: value)
            } else {
                throw encodingError(forValue: value, codingPath: container.codingPath)
            }
        }
    }

    static func encode(to container: inout SingleValueEncodingContainer, value: Any) throws {
        if let value = value as? Bool {
            try container.encode(value)
        } else if let value = value as? Int64 {
            try container.encode(value)
        } else if let value = value as? Double {
            try container.encode(value)
        } else if let value = value as? String {
            try container.encode(value)
        } else if value is JSONNull {
            try container.encodeNil()
        } else {
            throw encodingError(forValue: value, codingPath: container.codingPath)
        }
    }

    public required init(from decoder: Decoder) throws {
        if var arrayContainer = try? decoder.unkeyedContainer() {
            self.value = try JSONAny.decodeArray(from: &arrayContainer)
        } else if var container = try? decoder.container(keyedBy: JSONCodingKey.self) {
            self.value = try JSONAny.decodeDictionary(from: &container)
        } else {
            let container = try decoder.singleValueContainer()
            self.value = try JSONAny.decode(from: container)
        }
    }

    public func encode(to encoder: Encoder) throws {
        if let arr = self.value as? [Any] {
            var container = encoder.unkeyedContainer()
            try JSONAny.encode(to: &container, array: arr)
        } else if let dict = self.value as? [String: Any] {
            var container = encoder.container(keyedBy: JSONCodingKey.self)
            try JSONAny.encode(to: &container, dictionary: dict)
        } else {
            var container = encoder.singleValueContainer()
            try JSONAny.encode(to: &container, value: self.value)
        }
    }
}
