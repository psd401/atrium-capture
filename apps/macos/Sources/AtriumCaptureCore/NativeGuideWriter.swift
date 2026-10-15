// ABOUTME: Builds the metadata-only Capture Guide Writer request, validates the assistant's
// ABOUTME: JSON reply, and applies it to a reviewed session without touching user edits.
import AtriumCaptureContracts
import Foundation

public let nativeGuideWriterRequestLimitBytes = 131_072

public enum NativeGuideWriterError: Error, Equatable {
    case requestTooLarge
    case notJSON
    case invalid(String)
    case sessionMismatch
    case unknownStep(String)
    case missingStep(String)
}

public enum NativeGuideWriter {
    public static func buildRequest(for session: AtriumCaptureSession) throws -> String {
        let retainOrigin = session.policy.sourceURLRetention != .none
        let steps: [[String: Any]] = session.steps.sorted { $0.sequence < $1.sequence }.map { step in
            var record: [String: Any] = [
                "stepId": step.stepID,
                "sequence": step.sequence,
                "action": step.action.rawValue,
                "instruction": step.instruction.editedText ?? step.instruction.generatedText,
            ]
            put(&record, "role", step.target?.role)
            put(&record, "accessibleName", step.target?.accessibleName)
            put(&record, "pageTitle", step.target?.browser?.pageTitle)
            if retainOrigin, let origin = step.target?.browser?.origin {
                put(&record, "origin", normalizedOrigin(origin))
            }
            put(&record, "appName", step.target?.macos?.appName)
            put(&record, "windowTitle", step.target?.macos?.windowTitle)
            return record
        }
        let body: [String: Any] = [
            "schemaVersion": 1,
            "sessionId": session.sessionID,
            "title": session.title,
            "steps": steps,
        ]
        let data = try JSONSerialization.data(withJSONObject: body, options: [.sortedKeys])
        guard data.count <= nativeGuideWriterRequestLimitBytes else {
            throw NativeGuideWriterError.requestTooLarge
        }
        return String(decoding: data, as: UTF8.self)
    }

    public static func validate(text: String, session: AtriumCaptureSession) throws -> AtriumCaptureGuideSuggestion {
        var trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        if trimmed.hasPrefix("```") {
            trimmed = trimmed
                .replacingOccurrences(of: "^```(?:json)?\\s*", with: "", options: .regularExpression)
                .replacingOccurrences(of: "\\s*```$", with: "", options: .regularExpression)
        }
        guard let data = trimmed.data(using: .utf8),
              let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any]
        else { throw NativeGuideWriterError.notJSON }
        let allowed: Set<String> = ["schemaVersion", "sessionId", "title", "summary", "steps"]
        guard Set(object.keys).isSubset(of: allowed), allowed.isSubset(of: Set(object.keys)) else {
            throw NativeGuideWriterError.invalid("top-level properties")
        }
        let suggestion: AtriumCaptureGuideSuggestion
        do {
            suggestion = try AtriumContractCodec.makeDecoder().decode(AtriumCaptureGuideSuggestion.self, from: data)
        } catch {
            throw NativeGuideWriterError.invalid("decode")
        }
        guard suggestion.schemaVersion == 1 else { throw NativeGuideWriterError.invalid("schemaVersion") }
        guard suggestion.sessionID == session.sessionID else { throw NativeGuideWriterError.sessionMismatch }
        try check(suggestion.title, 1...200, "title")
        try check(suggestion.summary, 1...600, "summary")
        let sessionIDs = Set(session.steps.map(\.stepID))
        var seen = Set<String>()
        for step in suggestion.steps {
            guard sessionIDs.contains(step.stepID), !seen.contains(step.stepID) else {
                throw NativeGuideWriterError.unknownStep(step.stepID)
            }
            seen.insert(step.stepID)
            try check(step.title, 1...120, "step title")
            try check(step.instruction, 1...2_000, "instruction")
        }
        if let missing = sessionIDs.subtracting(seen).sorted().first {
            throw NativeGuideWriterError.missingStep(missing)
        }
        return suggestion
    }

    public static func apply(
        _ suggestion: AtriumCaptureGuideSuggestion,
        to session: AtriumCaptureSession,
        now: Date = Date()
    ) throws -> AtriumCaptureSession {
        var updated = try NativeReviewEditor.setTitle(in: session, title: suggestion.title, now: now)
        for step in suggestion.steps {
            updated = try NativeReviewEditor.suggestInstruction(
                in: updated,
                stepID: step.stepID,
                text: step.instruction,
                title: step.title,
                now: now
            )
        }
        return updated
    }

    /// Retain web provenance without sending literal local-network targets across the
    /// production boundary. Mirrors normalizeCaptureSourceOriginForPublication
    /// (packages/atrium-client/src/index.ts) for the Mac-side request builder.
    private static func normalizedOrigin(_ value: String) -> String? {
        guard let url = URL(string: value),
              let scheme = url.scheme, scheme == "http" || scheme == "https",
              url.user == nil, url.password == nil,
              let host = url.host, !isLocalNetworkHostLiteral(host)
        else { return nil }
        var components = URLComponents()
        components.scheme = scheme
        components.host = host
        components.port = url.port
        return components.url?.absoluteString
    }

    private static func isLocalNetworkHostLiteral(_ value: String) -> Bool {
        let hostname = value.lowercased()
        if hostname == "localhost" || hostname.hasSuffix(".localhost") { return true }
        let octets = hostname.split(separator: ".").map(String.init)
        if octets.count == 4, octets.allSatisfy({ $0.allSatisfy(\.isNumber) && (UInt8($0) != nil) }) {
            let bytes = octets.compactMap { UInt8($0) }
            guard bytes.count == 4 else { return false }
            if bytes[0] == 10 { return true }
            if bytes[0] == 127 { return true }
            if bytes[0] == 172, (16...31).contains(bytes[1]) { return true }
            if bytes[0] == 192, bytes[1] == 168 { return true }
            if bytes[0] == 169, bytes[1] == 254 { return true }
            if bytes[0] == 0 { return true }
            return false
        }
        return false
    }

    private static func put(_ record: inout [String: Any], _ key: String, _ value: String?) {
        guard let value = value?.trimmingCharacters(in: .whitespacesAndNewlines), !value.isEmpty else { return }
        record[key] = value
    }

    private static func check(_ value: String, _ range: ClosedRange<Int>, _ label: String) throws {
        let count = value.trimmingCharacters(in: .whitespacesAndNewlines).count
        guard range.contains(count) else { throw NativeGuideWriterError.invalid(label) }
    }
}
