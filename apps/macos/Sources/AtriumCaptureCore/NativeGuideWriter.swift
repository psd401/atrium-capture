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
    /// Whether a guide-writer result for `forSessionID`, obtained before an await, is still
    /// safe to apply. Checked again after the await: the active session may have changed, or
    /// publication may have started (or a publish job landed) and frozen the content, while the
    /// gateway call was in flight.
    public static func canApplyResult(
        forSessionID: String,
        latestSessionID: String?,
        guideContentFrozen: Bool
    ) -> Bool {
        !guideContentFrozen && latestSessionID == forSessionID
    }

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
        // URLComponents requires an IPv6 literal host to be bracketed, unlike
        // URL.host, which returns it unbracketed.
        components.host = host.contains(":") ? "[\(host)]" : host
        components.port = url.port
        return components.url?.absoluteString
    }

    private static func isLocalNetworkHostLiteral(_ value: String) -> Bool {
        var hostname = value.lowercased()
        if hostname.hasPrefix("["), hostname.hasSuffix("]") {
            hostname = String(hostname.dropFirst().dropLast())
        }
        if hostname == "localhost" || hostname.hasSuffix(".localhost") { return true }
        let octets = hostname.split(separator: ".").map(String.init)
        if octets.count == 4, octets.allSatisfy({ $0.allSatisfy(\.isNumber) && (UInt8($0) != nil) }) {
            let bytes = octets.compactMap { UInt8($0) }
            guard bytes.count == 4 else { return false }
            return isLocalIPv4(first: bytes[0], second: bytes[1])
        }
        if let mapped = mappedIPv4Bytes(hostname) {
            return isLocalIPv4(first: mapped.0, second: mapped.1)
        }
        // IPv6 loopback (::1), unspecified (::), unique-local (fc00::/7), and
        // link-local (fe80::/10) literals, mirroring isLocalNetworkHostLiteral
        // in packages/atrium-client/src/index.ts.
        if hostname == "::" || hostname == "::1" { return true }
        for prefix in ["fc", "fd", "fe8", "fe9", "fea", "feb"] where hostname.hasPrefix(prefix) {
            return true
        }
        return false
    }

    private static func isLocalIPv4(first: UInt8, second: UInt8) -> Bool {
        if first == 0 { return true }
        if first == 10 { return true }
        if first == 127 { return true }
        if first == 169, second == 254 { return true }
        if first == 172, (16...31).contains(second) { return true }
        if first == 192, second == 168 { return true }
        return false
    }

    private static func mappedIPv4Bytes(_ hostname: String) -> (UInt8, UInt8)? {
        guard hostname.hasPrefix("::ffff:") else { return nil }
        let groups = hostname.dropFirst("::ffff:".count).split(separator: ":")
        guard groups.count == 2,
              let high = UInt16(groups[0], radix: 16),
              let low = UInt16(groups[1], radix: 16)
        else { return nil }
        return (UInt8(high >> 8), UInt8(high & 0xff))
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
