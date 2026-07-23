import AtriumCaptureContracts
import AtriumCaptureCore
import Foundation

@main
enum AtriumCaptureNativeHost {
    static func main() {
        let input = FileHandle.standardInput
        let output = FileHandle.standardOutput
        while true {
            do {
                guard let header = try readExactly(4, from: input) else { return }
                let length = header.enumerated().reduce(UInt32(0)) { partial, item in
                    partial | (UInt32(item.element) << UInt32(item.offset * 8))
                }
                guard length > 0, length <= UInt32(NativeBridgeValidator.maximumMessageBytes),
                      let body = try readExactly(Int(length), from: input)
                else {
                    try writeResponse(type: "error", correlationID: nil, code: "INVALID_LENGTH", to: output)
                    return
                }
                let message = try NativeBridgeValidator.decode(body)
                let responseType = message.type == .hello ? "hello_ack" : "session_state"
                try writeResponse(
                    type: responseType,
                    correlationID: message.messageID,
                    code: "ACCEPTED_METADATA_ONLY",
                    to: output
                )
            } catch {
                try? writeResponse(type: "error", correlationID: nil, code: "INVALID_MESSAGE", to: output)
            }
        }
    }

    private static func readExactly(_ count: Int, from handle: FileHandle) throws -> Data? {
        var data = Data()
        while data.count < count {
            guard let chunk = try handle.read(upToCount: count - data.count), !chunk.isEmpty else {
                return data.isEmpty ? nil : nil
            }
            data.append(chunk)
        }
        return data
    }

    private static func writeResponse(
        type: String,
        correlationID: String?,
        code: String,
        to handle: FileHandle
    ) throws {
        var object: [String: Any] = [
            "protocolVersion": 1,
            "messageId": UUID().uuidString.lowercased(),
            "type": type,
            "sentAt": ISO8601DateFormatter().string(from: Date()),
            "payload": ["code": code],
        ]
        if let correlationID { object["correlationId"] = correlationID }
        let candidate = try JSONSerialization.data(withJSONObject: object, options: [.sortedKeys])
        let validated = try AtriumContractCodec.makeDecoder().decode(
            AtriumCaptureNativeBridgeMessage.self,
            from: candidate
        )
        let body = try AtriumContractCodec.makeEncoder().encode(validated)
        let count = UInt32(body.count)
        let header = Data([
            UInt8(count & 0xff),
            UInt8((count >> 8) & 0xff),
            UInt8((count >> 16) & 0xff),
            UInt8((count >> 24) & 0xff),
        ])
        try handle.write(contentsOf: header)
        try handle.write(contentsOf: body)
    }
}
