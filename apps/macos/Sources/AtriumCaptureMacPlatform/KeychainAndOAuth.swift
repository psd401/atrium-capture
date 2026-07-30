import Foundation

#if os(macOS)
import AppKit
import AuthenticationServices
import CryptoKit
import Security

public enum NativeKeychainError: Error {
    case invalidData
    case status(OSStatus)
}

public final class KeychainTokenStore: @unchecked Sendable {
    private let service: String

    public init(service: String = "org.psd401.AtriumCapture.oauth") {
        self.service = service
    }

    public func save(_ tokenData: Data, account: String = "atrium") throws {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
        ]
        let update = [kSecValueData as String: tokenData]
        let status = SecItemUpdate(query as CFDictionary, update as CFDictionary)
        if status == errSecItemNotFound {
            var add = query
            add[kSecValueData as String] = tokenData
            add[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
            let addStatus = SecItemAdd(add as CFDictionary, nil)
            guard addStatus == errSecSuccess else { throw NativeKeychainError.status(addStatus) }
        } else if status != errSecSuccess {
            throw NativeKeychainError.status(status)
        }
    }

    public func read(account: String = "atrium") throws -> Data? {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
            kSecReturnData as String: true,
            kSecMatchLimit as String: kSecMatchLimitOne,
        ]
        var result: CFTypeRef?
        let status = SecItemCopyMatching(query as CFDictionary, &result)
        if status == errSecItemNotFound { return nil }
        guard status == errSecSuccess else { throw NativeKeychainError.status(status) }
        guard let data = result as? Data else { throw NativeKeychainError.invalidData }
        return data
    }

    public func delete(account: String = "atrium") throws {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
        ]
        let status = SecItemDelete(query as CFDictionary)
        guard status == errSecSuccess || status == errSecItemNotFound else {
            throw NativeKeychainError.status(status)
        }
    }
}

public struct NativeOAuthConfiguration: Sendable {
    public let authorizationEndpoint: URL
    public let tokenEndpoint: URL
    public let revocationEndpoint: URL
    public let clientID: String
    public let redirectScheme: String
    public let resourceServer: URL
    public let scopes: [String]

    public init(
        authorizationEndpoint: URL,
        tokenEndpoint: URL,
        revocationEndpoint: URL,
        clientID: String,
        redirectScheme: String,
        resourceServer: URL,
        scopes: [String]
    ) throws {
        guard authorizationEndpoint.scheme == "https",
              tokenEndpoint.scheme == "https",
              revocationEndpoint.scheme == "https",
              resourceServer.scheme == "https",
              resourceServer.user == nil,
              resourceServer.password == nil,
              !clientID.isEmpty,
              !redirectScheme.isEmpty
        else { throw URLError(.badURL) }
        self.authorizationEndpoint = authorizationEndpoint
        self.tokenEndpoint = tokenEndpoint
        self.revocationEndpoint = revocationEndpoint
        self.clientID = clientID
        self.redirectScheme = redirectScheme
        self.resourceServer = resourceServer
        self.scopes = scopes
    }
}

public struct NativeOAuthAuthorization: Sendable {
    public let code: String
    public let verifier: String
    public let redirectURI: String

    public init(code: String, verifier: String, redirectURI: String) {
        self.code = code
        self.verifier = verifier
        self.redirectURI = redirectURI
    }
}

public struct NativeOAuthTokens: Codable, Sendable {
    public let accessToken: String
    public let clientID: String
    public let refreshToken: String?
    public let tokenType: String
    public let expiresAt: Date?

    public init(
        accessToken: String,
        clientID: String,
        refreshToken: String?,
        tokenType: String,
        expiresAt: Date?
    ) {
        self.accessToken = accessToken
        self.clientID = clientID
        self.refreshToken = refreshToken
        self.tokenType = tokenType
        self.expiresAt = expiresAt
    }
}

private struct NativeOAuthTokenResponse: Decodable {
    let accessToken: String
    let refreshToken: String?
    let tokenType: String
    let expiresIn: Int

    enum CodingKeys: String, CodingKey {
        case accessToken = "access_token"
        case refreshToken = "refresh_token"
        case tokenType = "token_type"
        case expiresIn = "expires_in"
    }
}

public enum NativeOAuthError: Error {
    case invalidTokenResponse
    case requestFailed(retryable: Bool)
    case responseTooLarge
    case secureRandomUnavailable
}

public final class NativeOAuthTokenClient: @unchecked Sendable {
    private let session: URLSession

    public init(session: URLSession = .shared) {
        self.session = session
    }

    public func exchange(
        configuration: NativeOAuthConfiguration,
        authorization: NativeOAuthAuthorization,
        now: Date = Date()
    ) async throws -> NativeOAuthTokens {
        var request = URLRequest(url: configuration.tokenEndpoint)
        request.httpMethod = "POST"
        request.setValue("application/x-www-form-urlencoded", forHTTPHeaderField: "Content-Type")
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        let fields = [
            "grant_type": "authorization_code",
            "client_id": configuration.clientID,
            "code": authorization.code,
            "code_verifier": authorization.verifier,
            "redirect_uri": authorization.redirectURI,
        ]
        request.httpBody = fields
            .sorted(by: { $0.key < $1.key })
            .map { "\(Self.formEncode($0.key))=\(Self.formEncode($0.value))" }
            .joined(separator: "&")
            .data(using: .utf8)
        let (data, response) = try await session.data(for: request)
        guard data.count <= 64 * 1_024 else { throw NativeOAuthError.responseTooLarge }
        guard let http = response as? HTTPURLResponse else {
            throw NativeOAuthError.invalidTokenResponse
        }
        guard (200..<300).contains(http.statusCode) else {
            throw NativeOAuthError.requestFailed(
                retryable: http.statusCode == 408
                    || http.statusCode == 429
                    || http.statusCode >= 500
            )
        }
        let decoded = try JSONDecoder().decode(NativeOAuthTokenResponse.self, from: data)
        guard !decoded.accessToken.isEmpty,
              decoded.accessToken.count <= 16_384,
              decoded.tokenType.caseInsensitiveCompare("Bearer") == .orderedSame,
              decoded.refreshToken?.count ?? 0 <= 16_384,
              (1...31_536_000).contains(decoded.expiresIn)
        else { throw NativeOAuthError.invalidTokenResponse }
        return NativeOAuthTokens(
            accessToken: decoded.accessToken,
            clientID: configuration.clientID,
            refreshToken: decoded.refreshToken,
            tokenType: "Bearer",
            expiresAt: now.addingTimeInterval(TimeInterval(decoded.expiresIn))
        )
    }

    public func refresh(
        configuration: NativeOAuthConfiguration,
        refreshToken: String,
        now: Date = Date()
    ) async throws -> NativeOAuthTokens {
        let data = try await sendForm(
            endpoint: configuration.tokenEndpoint,
            fields: [
                "client_id": configuration.clientID,
                "grant_type": "refresh_token",
                "refresh_token": refreshToken,
            ],
            expectsJSON: true
        )
        let decoded = try JSONDecoder().decode(NativeOAuthTokenResponse.self, from: data)
        guard !decoded.accessToken.isEmpty,
              decoded.accessToken.count <= 16_384,
              decoded.tokenType.caseInsensitiveCompare("Bearer") == .orderedSame,
              decoded.refreshToken?.count ?? 0 <= 16_384,
              (1...31_536_000).contains(decoded.expiresIn)
        else { throw NativeOAuthError.invalidTokenResponse }
        return NativeOAuthTokens(
            accessToken: decoded.accessToken,
            clientID: configuration.clientID,
            refreshToken: decoded.refreshToken ?? refreshToken,
            tokenType: "Bearer",
            expiresAt: now.addingTimeInterval(TimeInterval(decoded.expiresIn))
        )
    }

    public func revoke(
        configuration: NativeOAuthConfiguration,
        token: String,
        tokenTypeHint: String
    ) async throws {
        _ = try await sendForm(
            endpoint: configuration.revocationEndpoint,
            fields: [
                "client_id": configuration.clientID,
                "token": token,
                "token_type_hint": tokenTypeHint,
            ],
            expectsJSON: false
        )
    }

    private func sendForm(
        endpoint: URL,
        fields: [String: String],
        expectsJSON: Bool
    ) async throws -> Data {
        var request = URLRequest(url: endpoint)
        request.httpMethod = "POST"
        request.setValue("application/x-www-form-urlencoded", forHTTPHeaderField: "Content-Type")
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        request.setValue("no-store", forHTTPHeaderField: "Cache-Control")
        request.httpBody = fields
            .sorted(by: { $0.key < $1.key })
            .map { "\(Self.formEncode($0.key))=\(Self.formEncode($0.value))" }
            .joined(separator: "&")
            .data(using: .utf8)
        let (data, response) = try await session.data(for: request)
        guard data.count <= 64 * 1_024 else { throw NativeOAuthError.responseTooLarge }
        guard let http = response as? HTTPURLResponse else {
            throw NativeOAuthError.invalidTokenResponse
        }
        guard (200..<300).contains(http.statusCode) else {
            throw NativeOAuthError.requestFailed(
                retryable: http.statusCode == 408
                    || http.statusCode == 429
                    || http.statusCode >= 500
            )
        }
        if expectsJSON, data.isEmpty {
            throw NativeOAuthError.invalidTokenResponse
        }
        return data
    }

    private static func formEncode(_ value: String) -> String {
        value.addingPercentEncoding(withAllowedCharacters: .alphanumerics) ?? ""
    }
}

@MainActor
public final class NativeOAuthCoordinator {
    private let browserSession: NativeOAuthSession
    private let tokenClient: NativeOAuthTokenClient
    private let keychain: KeychainTokenStore

    public init(
        browserSession: NativeOAuthSession = NativeOAuthSession(),
        tokenClient: NativeOAuthTokenClient = NativeOAuthTokenClient(),
        keychain: KeychainTokenStore = KeychainTokenStore()
    ) {
        self.browserSession = browserSession
        self.tokenClient = tokenClient
        self.keychain = keychain
    }

    public func signIn(configuration: NativeOAuthConfiguration) async throws -> Date? {
        let authorization = try await browserSession.authorize(configuration: configuration)
        let tokens = try await tokenClient.exchange(
            configuration: configuration,
            authorization: authorization
        )
        let data = try JSONEncoder().encode(tokens)
        let keychain = self.keychain
        try await Task.detached { try keychain.save(data) }.value
        return tokens.expiresAt
    }

    public func accessToken(configuration: NativeOAuthConfiguration, now: Date = Date()) async throws -> String {
        guard var tokens = try await readTokens(),
              tokens.clientID == configuration.clientID
        else { throw NativeOAuthError.invalidTokenResponse }
        if tokens.expiresAt.map({ $0 > now.addingTimeInterval(60) }) ?? true {
            return tokens.accessToken
        }
        guard let refreshToken = tokens.refreshToken else {
            try await deleteTokens()
            throw NativeOAuthError.invalidTokenResponse
        }
        do {
            tokens = try await tokenClient.refresh(
                configuration: configuration,
                refreshToken: refreshToken,
                now: now
            )
            let data = try JSONEncoder().encode(tokens)
            let keychain = self.keychain
            try await Task.detached { try keychain.save(data) }.value
            return tokens.accessToken
        } catch {
            let shouldClear: Bool
            if let oauthError = error as? NativeOAuthError,
               case let .requestFailed(retryable) = oauthError {
                shouldClear = !retryable
            } else {
                shouldClear = !(error is URLError)
            }
            if shouldClear {
                try? await deleteTokens()
            }
            throw error
        }
    }

    public func status(configuration: NativeOAuthConfiguration, now: Date = Date()) async -> NativeAuthenticationStatus {
        guard let tokens = try? await readTokens(),
              tokens.clientID == configuration.clientID
        else { return .signedOut }
        if let expiresAt = tokens.expiresAt, expiresAt <= now, tokens.refreshToken == nil {
            try? await deleteTokens()
            return .signedOut
        }
        return .signedIn
    }

    public func signOut(configuration: NativeOAuthConfiguration?) async throws {
        let tokens = try? await readTokens()
        try await deleteTokens()
        guard let configuration,
              let tokens,
              tokens.clientID == configuration.clientID
        else { return }
        let token = tokens.refreshToken ?? tokens.accessToken
        let hint = tokens.refreshToken == nil ? "access_token" : "refresh_token"
        try? await tokenClient.revoke(
            configuration: configuration,
            token: token,
            tokenTypeHint: hint
        )
    }

    private func readTokens() async throws -> NativeOAuthTokens? {
        let keychain = self.keychain
        guard let data = try await Task.detached(operation: { try keychain.read() }).value else {
            return nil
        }
        guard data.count <= 64 * 1_024 else { throw NativeOAuthError.responseTooLarge }
        let tokens = try JSONDecoder().decode(NativeOAuthTokens.self, from: data)
        guard !tokens.accessToken.isEmpty,
              tokens.accessToken.count <= 16_384,
              !tokens.accessToken.contains("\n"),
              !tokens.accessToken.contains("\r"),
              UUID(uuidString: tokens.clientID) != nil,
              tokens.tokenType.caseInsensitiveCompare("Bearer") == .orderedSame,
              tokens.expiresAt != nil,
              tokens.refreshToken.map({
                  !$0.isEmpty && $0.count <= 16_384 && !$0.contains("\n") && !$0.contains("\r")
              }) ?? true
        else { throw NativeOAuthError.invalidTokenResponse }
        return tokens
    }

    private func deleteTokens() async throws {
        let keychain = self.keychain
        try await Task.detached { try keychain.delete() }.value
    }
}

public enum NativeAuthenticationStatus: String, Sendable {
    case signedIn = "signed_in"
    case signedOut = "signed_out"
    case unconfigured
}

@MainActor
public final class NativeOAuthSession: NSObject, ASWebAuthenticationPresentationContextProviding {
    private var session: ASWebAuthenticationSession?

    public override init() {}

    public func authorize(configuration: NativeOAuthConfiguration) async throws -> NativeOAuthAuthorization {
        let verifier = try Self.randomURLSafe(bytes: 32)
        let challenge = Self.base64URL(Data(SHA256.hash(data: Data(verifier.utf8))))
        let state = try Self.randomURLSafe(bytes: 24)
        let redirectURI = "\(configuration.redirectScheme):/oauth/callback"
        let url = try Self.authorizationURL(
            configuration: configuration,
            codeChallenge: challenge,
            state: state
        )

        let callbackURL = try await withCheckedThrowingContinuation {
            (continuation: CheckedContinuation<URL, any Error>) in
            let webSession = ASWebAuthenticationSession(
                url: url,
                callbackURLScheme: configuration.redirectScheme,
                completionHandler: Self.authorizationCallback(continuation: continuation)
            )
            webSession.presentationContextProvider = self
            // Reuse the browser's normal session so district SSO and the user's
            // expected Google account are available during sign-in.
            webSession.prefersEphemeralWebBrowserSession = false
            session = webSession
            guard webSession.start() else {
                continuation.resume(throwing: URLError(.cannotLoadFromNetwork))
                return
            }
        }
        session = nil
        let callback = URLComponents(url: callbackURL, resolvingAgainstBaseURL: false)
        let returnedState = callback?.queryItems?.first(where: { $0.name == "state" })?.value
        let code = callback?.queryItems?.first(where: { $0.name == "code" })?.value
        guard callbackURL.scheme == configuration.redirectScheme,
              callbackURL.path == "/oauth/callback",
              returnedState == state,
              let code,
              !code.isEmpty,
              code.count <= 16_384
        else { throw URLError(.userAuthenticationRequired) }
        return NativeOAuthAuthorization(code: code, verifier: verifier, redirectURI: redirectURI)
    }

    nonisolated static func authorizationCallback(
        continuation: CheckedContinuation<URL, any Error>
    ) -> @Sendable (URL?, (any Error)?) -> Void {
        { callback, error in
            if let error {
                continuation.resume(throwing: error)
            } else if let callback {
                continuation.resume(returning: callback)
            } else {
                continuation.resume(throwing: URLError(.badServerResponse))
            }
        }
    }

    nonisolated static func authorizationURL(
        configuration: NativeOAuthConfiguration,
        codeChallenge: String,
        state: String
    ) throws -> URL {
        let redirectURI = "\(configuration.redirectScheme):/oauth/callback"
        var components = URLComponents(url: configuration.authorizationEndpoint, resolvingAgainstBaseURL: false)
        components?.queryItems = [
            URLQueryItem(name: "response_type", value: "code"),
            URLQueryItem(name: "client_id", value: configuration.clientID),
            URLQueryItem(name: "redirect_uri", value: redirectURI),
            URLQueryItem(name: "scope", value: configuration.scopes.joined(separator: " ")),
            URLQueryItem(name: "resource", value: configuration.resourceServer.absoluteString),
            URLQueryItem(name: "state", value: state),
            URLQueryItem(name: "code_challenge", value: codeChallenge),
            URLQueryItem(name: "code_challenge_method", value: "S256"),
        ]
        guard let url = components?.url else { throw URLError(.badURL) }
        return url
    }

    public func presentationAnchor(for _: ASWebAuthenticationSession) -> ASPresentationAnchor {
        NSApplication.shared.keyWindow ?? NSApplication.shared.windows.first ?? ASPresentationAnchor()
    }

    private static func randomURLSafe(bytes: Int) throws -> String {
        var data = Data(count: bytes)
        let status = data.withUnsafeMutableBytes {
            SecRandomCopyBytes(kSecRandomDefault, bytes, $0.baseAddress!)
        }
        guard status == errSecSuccess else { throw NativeOAuthError.secureRandomUnavailable }
        return base64URL(data)
    }

    private static func base64URL(_ data: Data) -> String {
        data.base64EncodedString()
            .replacingOccurrences(of: "+", with: "-")
            .replacingOccurrences(of: "/", with: "_")
            .replacingOccurrences(of: "=", with: "")
    }
}
#else
public final class KeychainTokenStore: @unchecked Sendable {
    public init(service _: String = "org.psd401.AtriumCapture.oauth") {}
}
#endif
