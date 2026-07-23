import AtriumCaptureContracts
import Foundation

public enum NativeBridgeValidationError: Error, Equatable {
    case messageTooLarge
    case invalidJSON
    case unsupportedProtocol
    case invalidIdentifier
    case prohibitedPayload
}

public enum NativeBridgeValidator {
    public static let maximumMessageBytes = 64 * 1_024

    public static func decode(_ data: Data) throws -> AtriumCaptureNativeBridgeMessage {
        guard data.count <= maximumMessageBytes else { throw NativeBridgeValidationError.messageTooLarge }
        guard let object = try? JSONSerialization.jsonObject(with: data),
              let dictionary = object as? [String: Any]
        else { throw NativeBridgeValidationError.invalidJSON }
        let allowedKeys: Set<String> = [
            "protocolVersion", "messageId", "correlationId", "type", "sentAt", "payload"
        ]
        guard Set(dictionary.keys).isSubset(of: allowedKeys) else {
            throw NativeBridgeValidationError.invalidJSON
        }
        guard let version = dictionary["protocolVersion"] as? NSNumber, version.doubleValue == 1 else {
            throw NativeBridgeValidationError.unsupportedProtocol
        }
        guard let messageID = dictionary["messageId"] as? String,
              !messageID.isEmpty,
              messageID.count <= 128
        else { throw NativeBridgeValidationError.invalidIdentifier }
        guard let payload = dictionary["payload"] as? [String: Any], isMetadataOnly(payload) else {
            throw NativeBridgeValidationError.prohibitedPayload
        }
        do {
            return try AtriumContractCodec.makeDecoder().decode(
                AtriumCaptureNativeBridgeMessage.self,
                from: data
            )
        } catch {
            throw NativeBridgeValidationError.invalidJSON
        }
    }

    private static func isMetadataOnly(_ value: Any) -> Bool {
        if let dictionary = value as? [String: Any] {
            for (key, nested) in dictionary {
                let normalized = key.lowercased().replacingOccurrences(of: "_", with: "")
                let forbidden = [
                    "authorization", "accesstoken", "refreshtoken", "bearertoken",
                    "screenshotbytes", "imagedata", "imagebytes", "pixelbytes", "base64",
                    "value", "fieldvalue", "typedvalue", "password"
                ]
                if forbidden.contains(normalized) || !isMetadataOnly(nested) { return false }
            }
            return true
        }
        if let array = value as? [Any] { return array.allSatisfy(isMetadataOnly) }
        if let string = value as? String {
            let normalized = string.lowercased()
            return !normalized.contains("data:image/")
                && !normalized.hasPrefix("bearer ")
                && !normalized.contains("-----begin private key-----")
        }
        return value is NSNull || value is NSNumber
    }
}
