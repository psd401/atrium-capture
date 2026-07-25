# Atrium client

Owns Authorization Code + PKCE primitives, authentication-neutral request/response types, the `AtriumGateway` interface, durable publication and post-create title reconciliation, Markdown generation, retry classification, stable idempotency keys, the documented production v1 gateway, and local mock implementations.

The production gateway is pinned to the documented AI Studio origin and validates private/bodyless creation, collection choices, authored assets, versions, and publication responses. Its caller owns trusted OAuth token lifecycle. The HTTP mock uses the visibly test-only `/_mock/atrium-capture/v1` namespace. See ADR 0006 for the non-idempotent asset-reservation interval.
