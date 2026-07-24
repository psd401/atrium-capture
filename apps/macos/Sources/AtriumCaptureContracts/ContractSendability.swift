// quicktype emits immutable value types but does not currently add Swift
// concurrency conformances. These root snapshots cross publisher actors only
// after value construction and are never mutated in place.
extension AtriumCaptureSession: @unchecked Sendable {}
extension AtriumCapturePublishJob: @unchecked Sendable {}
