import Foundation

/// The single JSON codec for generated contract models.
///
/// JSON Schema date-time permits fractional seconds, while Foundation's built-in
/// `.iso8601` strategy does not accept them consistently across platforms.
public enum AtriumContractCodec {
    public static func makeDecoder() -> JSONDecoder {
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .custom { decoder in
            let value = try decoder.singleValueContainer().decode(String.self)
            let fractionalFormatter = ISO8601DateFormatter()
            fractionalFormatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]

            if let date = fractionalFormatter.date(from: value) {
                return date
            }

            let wholeSecondFormatter = ISO8601DateFormatter()
            wholeSecondFormatter.formatOptions = [.withInternetDateTime]
            if let date = wholeSecondFormatter.date(from: value) {
                return date
            }

            throw DecodingError.dataCorruptedError(
                in: try decoder.singleValueContainer(),
                debugDescription: "Expected an RFC 3339 date-time string."
            )
        }
        return decoder
    }

    public static func makeEncoder() -> JSONEncoder {
        let encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .custom { date, encoder in
            let formatter = ISO8601DateFormatter()
            formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
            var container = encoder.singleValueContainer()
            try container.encode(formatter.string(from: date))
        }
        return encoder
    }
}
