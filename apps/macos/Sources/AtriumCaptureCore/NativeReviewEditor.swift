import AtriumCaptureContracts
import Foundation

public enum NativeReviewError: Error, Equatable {
    case stepNotFound
    case invalidGeometry
    case rawAssetNotPublishable
    case incompletePrivacyReview
    case sensitiveRegionRequiresRedaction
}

public enum NativeReviewEditor {
    public static func setInstruction(
        in session: AtriumCaptureSession,
        stepID: String,
        text: String,
        now: Date = Date()
    ) throws -> AtriumCaptureSession {
        try updateStep(in: session, stepID: stepID, now: now) { step in
            step.with(instruction: step.instruction.with(
                editedText: String(text.trimmingCharacters(in: .whitespacesAndNewlines).prefix(500)),
                source: .user,
                userEdited: true
            ), privacyReview: reviewAfterEdit(step))
        }
    }

    public static func setCrop(
        in session: AtriumCaptureSession,
        stepID: String,
        crop: NativeRect?,
        now: Date = Date()
    ) throws -> AtriumCaptureSession {
        if let crop, !crop.isValid { throw NativeReviewError.invalidGeometry }
        return try updateStep(in: session, stepID: stepID, now: now) { step in
            step.with(crop: .some(crop?.contractGeometry), privacyReview: reviewAfterEdit(step))
        }
    }

    public static func setAnnotations(
        in session: AtriumCaptureSession,
        stepID: String,
        annotations: [AnnotationElement],
        now: Date = Date()
    ) throws -> AtriumCaptureSession {
        guard annotations.allSatisfy({
            let geometry = $0.geometry
            return NativeRect(x: geometry.x, y: geometry.y, width: geometry.width, height: geometry.height).isValid
                && ($0.kind == .arrow || $0.arrowDirection == nil)
        }) else { throw NativeReviewError.invalidGeometry }
        return try updateStep(in: session, stepID: stepID, now: now) { step in
            step.with(annotations: annotations, privacyReview: reviewAfterEdit(step))
        }
    }

    public static func approveStep(
        in session: AtriumCaptureSession,
        stepID: String,
        now: Date = Date()
    ) throws -> AtriumCaptureSession {
        guard let step = session.steps.first(where: { $0.stepID == stepID }) else {
            throw NativeReviewError.stepNotFound
        }
        if requiresPermanentRedaction(step), !hasOpaqueRedaction(step.annotations ?? []) {
            throw NativeReviewError.sensitiveRegionRequiresRedaction
        }
        return try updateStep(in: session, stepID: stepID, now: now) { step in
            step.with(privacyReview: .approved)
        }
    }

    public static func validatePrivacyAnnotations(in session: AtriumCaptureSession) throws {
        guard session.steps.allSatisfy({
            !requiresPermanentRedaction($0) || hasOpaqueRedaction($0.annotations ?? [])
        }) else {
            throw NativeReviewError.sensitiveRegionRequiresRedaction
        }
    }

    public static func moveStep(
        in session: AtriumCaptureSession,
        stepID: String,
        toIndex: Int,
        now: Date = Date()
    ) throws -> AtriumCaptureSession {
        guard let fromIndex = session.steps.firstIndex(where: { $0.stepID == stepID }) else {
            throw NativeReviewError.stepNotFound
        }
        var steps = session.steps
        let step = steps.remove(at: fromIndex)
        steps.insert(step, at: min(max(0, toIndex), steps.count))
        return revised(session, steps: resequence(steps), assets: session.assets, now: now)
    }

    public static func deleteStep(
        in session: AtriumCaptureSession,
        stepID: String,
        now: Date = Date()
    ) throws -> AtriumCaptureSession {
        guard session.steps.contains(where: { $0.stepID == stepID }) else {
            throw NativeReviewError.stepNotFound
        }
        let steps = resequence(session.steps.filter { $0.stepID != stepID })
        return revised(
            session,
            steps: steps,
            assets: tombstoneUnreferencedAssets(session.assets, steps: steps),
            now: now
        )
    }

    public static func insertManualStep(
        in session: AtriumCaptureSession,
        afterStepID: String?,
        text: String,
        now: Date = Date(),
        stepID: String = UUID().uuidString.lowercased()
    ) throws -> AtriumCaptureSession {
        let clean = String(text.trimmingCharacters(in: .whitespacesAndNewlines).prefix(500))
        guard !clean.isEmpty else { throw NativeReviewError.stepNotFound }
        let insertionIndex: Int
        if let afterStepID {
            guard let index = session.steps.firstIndex(where: { $0.stepID == afterStepID }) else {
                throw NativeReviewError.stepNotFound
            }
            insertionIndex = index + 1
        } else {
            insertionIndex = session.steps.count
        }
        var steps = session.steps
        steps.insert(StepElement(
            action: .manual,
            annotations: [],
            crop: nil,
            instruction: Instruction(editedText: clean, generatedText: clean, source: .user, userEdited: true),
            occurredAt: now,
            privacyReview: .notReviewed,
            screenshotAssetID: nil,
            sequence: insertionIndex,
            stepID: stepID,
            target: nil
        ), at: insertionIndex)
        return revised(session, steps: resequence(steps), assets: session.assets, now: now)
    }

    public static func mergeStepWithNext(
        in session: AtriumCaptureSession,
        stepID: String,
        now: Date = Date()
    ) throws -> AtriumCaptureSession {
        guard let index = session.steps.firstIndex(where: { $0.stepID == stepID }),
              index + 1 < session.steps.count
        else { throw NativeReviewError.stepNotFound }
        let first = session.steps[index]
        let second = session.steps[index + 1]
        let firstText = first.instruction.editedText ?? first.instruction.generatedText
        let secondText = second.instruction.editedText ?? second.instruction.generatedText
        let review: PrivacyReview = if first.privacyReview == .flagged || second.privacyReview == .flagged {
            .flagged
        } else if first.privacyReview == .approved && second.privacyReview == .approved {
            .approved
        } else {
            .notReviewed
        }
        let merged = first.with(
            annotations: (first.annotations ?? []) + (second.annotations ?? []),
            crop: .some(first.crop ?? second.crop),
            instruction: Instruction(
                editedText: "\(firstText) \(secondText)",
                generatedText: "\(firstText) \(secondText)",
                source: .user,
                userEdited: true
            ),
            privacyReview: review,
            screenshotAssetID: .some(first.screenshotAssetID ?? second.screenshotAssetID),
            target: .some(first.target ?? second.target)
        )
        var steps = session.steps
        steps[index] = merged
        steps.remove(at: index + 1)
        steps = resequence(steps)
        return revised(
            session,
            steps: steps,
            assets: tombstoneUnreferencedAssets(session.assets, steps: steps),
            now: now
        )
    }

    public static func markFlattened(
        in session: AtriumCaptureSession,
        rawAssetID: String,
        publishable: NativeCapturedAsset,
        annotations: [AnnotationElement],
        now: Date = Date()
    ) throws -> AtriumCaptureSession {
        guard let raw = session.assets.first(where: { $0.assetID == rawAssetID }), raw.state == .rawLocal else {
            throw NativeReviewError.rawAssetNotPublishable
        }
        let affectedSteps = session.steps.filter { $0.screenshotAssetID == rawAssetID }
        guard !affectedSteps.isEmpty else { throw NativeReviewError.rawAssetNotPublishable }
        if affectedSteps.contains(where: requiresPermanentRedaction), !hasOpaqueRedaction(annotations) {
            throw NativeReviewError.sensitiveRegionRequiresRedaction
        }
        var assets = session.assets.map { asset in
            asset.assetID == rawAssetID ? asset.with(state: .deleted) : asset
        }
        assets.append(AssetElement(
            annotations: annotations,
            assetID: publishable.assetID,
            derivedFromAssetID: rawAssetID,
            localKey: publishable.localKey,
            mimeType: .imagePNG,
            pixelHeight: publishable.pixelHeight,
            pixelWidth: publishable.pixelWidth,
            sha256: publishable.sha256,
            state: .publishableLocal
        ))
        let steps = session.steps.map { step in
            step.screenshotAssetID == rawAssetID
                ? step.with(annotations: annotations, screenshotAssetID: .some(publishable.assetID))
                : step
        }
        return session.with(
            assets: assets,
            revision: session.revision + 1,
            steps: steps,
            updatedAt: now
        )
    }

    public static func approveSession(
        _ session: AtriumCaptureSession,
        now: Date = Date()
    ) throws -> AtriumCaptureSession {
        guard session.steps.allSatisfy({ $0.privacyReview == .approved }) else {
            throw NativeReviewError.incompletePrivacyReview
        }
        try validatePrivacyAnnotations(in: session)
        guard session.assets.allSatisfy({ $0.state != .rawLocal && $0.state != .redactedLocal }) else {
            throw NativeReviewError.rawAssetNotPublishable
        }
        let referenced = Set(session.steps.compactMap(\.screenshotAssetID))
        guard session.assets.allSatisfy({
            $0.state == .deleted || ($0.state == .publishableLocal && referenced.contains($0.assetID))
        }), referenced.allSatisfy({ assetID in
            session.assets.contains { $0.assetID == assetID && $0.state == .publishableLocal }
        }) else {
            throw NativeReviewError.rawAssetNotPublishable
        }
        return session.with(
            policy: session.policy.with(reviewStatus: .approved),
            revision: session.revision + 1,
            state: .publishable,
            updatedAt: now
        )
    }

    private static func updateStep(
        in session: AtriumCaptureSession,
        stepID: String,
        now: Date,
        transform: (StepElement) -> StepElement
    ) throws -> AtriumCaptureSession {
        guard session.steps.contains(where: { $0.stepID == stepID }) else {
            throw NativeReviewError.stepNotFound
        }
        let steps = session.steps.map { $0.stepID == stepID ? transform($0) : $0 }
        return session.with(
            revision: session.revision + 1,
            steps: steps,
            updatedAt: now
        )
    }

    private static func resequence(_ steps: [StepElement]) -> [StepElement] {
        steps.enumerated().map { index, step in step.with(sequence: index) }
    }

    private static func tombstoneUnreferencedAssets(
        _ assets: [AssetElement],
        steps: [StepElement]
    ) -> [AssetElement] {
        let referenced = Set(steps.compactMap(\.screenshotAssetID))
        return assets.map { asset in
            referenced.contains(asset.assetID) ? asset : asset.with(state: .deleted)
        }
    }

    private static func revised(
        _ session: AtriumCaptureSession,
        steps: [StepElement],
        assets: [AssetElement],
        now: Date
    ) -> AtriumCaptureSession {
        session.with(
            assets: assets,
            revision: session.revision + 1,
            steps: steps,
            updatedAt: now
        )
    }

    private static func reviewAfterEdit(_ step: StepElement) -> PrivacyReview {
        step.privacyReview == .flagged ? .flagged : .notReviewed
    }

    private static func requiresPermanentRedaction(_ step: StepElement) -> Bool {
        (step.action == .input || step.privacyReview == .flagged) && step.screenshotAssetID != nil
    }

    private static func hasOpaqueRedaction(_ annotations: [AnnotationElement]) -> Bool {
        annotations.contains { annotation in
            guard annotation.kind == .redaction else { return false }
            let geometry = annotation.geometry
            return geometry.x.isFinite && geometry.y.isFinite
                && geometry.width.isFinite && geometry.height.isFinite
                && geometry.width > 0 && geometry.height > 0
        }
    }
}
