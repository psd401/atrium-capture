# Contributing

Atrium Capture is a greenfield MIT-licensed project. Contributions must be original or come from a clearly identified dependency with a compatible license. Do not paste or port code from competing products or research repositories.

Before opening a pull request:

1. Read `AGENTS.md` and the architecture/security documents.
2. Update the shared contract first when changing persisted or cross-platform data.
3. Add tests proportional to the change, including privacy failure cases.
4. Run the repository check, lint, typecheck, and test commands that exist for the affected workspaces.
5. Explain any new browser permission, macOS entitlement, network destination, data-retention behavior, or Atrium scope in the pull request.

Never use real district data in development or tests.
