# Atrium client

Owns Authorization Code + PKCE primitives, authentication-neutral request/response types, the `AtriumGateway` interface, durable publication orchestration, Markdown generation, retry classification, stable idempotency keys, and local mock implementations.

No production route is hard-coded. Live capabilities remain unavailable until Atrium documents and deploys OAuth token validation, immutable authored assets, collection discovery, and idempotent content/version writes. The HTTP mock uses the visibly test-only `/_mock/atrium-capture/v1` namespace.
