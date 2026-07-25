#if os(macOS)
import AtriumCaptureContracts
import AtriumCaptureCore
import AtriumCaptureMacPlatform
import SwiftUI

struct AtriumCaptureWorkspaceView: View {
    @ObservedObject var model: CaptureAppModel
    @State private var selectedToolByStep: [String: Kind] = [:]
    @State private var draftRectByStep: [String: CGRect] = [:]
    @State private var annotationTextByStep: [String: String] = [:]

    var body: some View {
        NavigationSplitView {
            ScrollView {
                VStack(alignment: .leading, spacing: 16) {
                    brandHeader
                    if !captureAccessReady {
                        permissionCard
                    }
                    recordingCard
                    reviewAndPublishCard
                    if !model.pins.isEmpty {
                        pinsCard
                    }
                }
                .padding(18)
            }
            .background(AtriumCaptureTheme.canvas)
            .navigationSplitViewColumnWidth(min: 320, ideal: 355, max: 420)
        } detail: {
            guideWorkspace
        }
        .background(AtriumCaptureTheme.canvas)
        .tint(AtriumCaptureTheme.evergreen)
        .frame(minWidth: 920, minHeight: 620)
    }

    private var brandHeader: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(spacing: 12) {
                AtriumBrandMark()
                VStack(alignment: .leading, spacing: 2) {
                    Text("ATRIUM")
                        .font(.system(size: 11, weight: .bold))
                        .tracking(1.2)
                        .foregroundStyle(AtriumCaptureTheme.muted)
                    Text("Capture")
                        .font(.system(size: 22, weight: .bold))
                        .foregroundStyle(AtriumCaptureTheme.ink)
                }
                Spacer()
            }
            AtriumStatusPill(
                label: humanizedStatus,
                recording: model.session?.state == .recording
            )
            Label("Private by default · reviewed before publishing", systemImage: "lock.fill")
                .font(.system(size: 11, weight: .medium))
                .foregroundStyle(AtriumCaptureTheme.muted)
        }
        .padding(.horizontal, 2)
    }

    private var permissionCard: some View {
        sectionCard(title: "Capture access", systemImage: "checkmark.shield") {
            permissionRow("Screen Recording", model.permissions.screenRecording)
            permissionRow("Accessibility", model.permissions.accessibility)
            Text(
                model.permissions.screenRecording == .granted
                    ? "Screen Recording is ready. Grant Accessibility next; Atrium Capture will then appear in that privacy list."
                    : "Grant Screen Recording first. If macOS asks, quit and reopen Atrium Capture before granting Accessibility."
            )
            .font(.system(size: 11))
            .foregroundStyle(AtriumCaptureTheme.inkSoft)

            Button(
                model.permissions.screenRecording == .granted
                    ? "Grant Accessibility"
                    : "Grant Screen Recording"
            ) {
                model.requestPermissions()
            }
            .buttonStyle(AtriumPrimaryButtonStyle())

            HStack(spacing: 8) {
                Button("Screen Recording settings") {
                    model.openScreenRecordingSettings()
                }
                Button("Accessibility settings") {
                    model.openAccessibilitySettings()
                }
            }
            .buttonStyle(AtriumSecondaryButtonStyle())
        }
    }

    private var captureAccessReady: Bool {
        model.permissions.screenRecording == .granted
            && model.permissions.accessibility == .granted
    }

    private var recordingCard: some View {
        sectionCard(title: "Recorder", systemImage: "record.circle") {
            HStack(spacing: 8) {
                Button("Start") { model.start() }
                    .buttonStyle(AtriumPrimaryButtonStyle())
                    .disabled(model.session?.state == .recording)
                Button(model.session?.state == .paused ? "Resume" : "Pause") {
                    model.pauseOrResume()
                }
                .buttonStyle(AtriumSecondaryButtonStyle())
                .disabled(
                    model.session?.state != .recording
                        && model.session?.state != .paused
                )
                Button("Stop") { model.stop() }
                    .buttonStyle(AtriumSecondaryButtonStyle())
                    .disabled(
                        model.session?.state != .recording
                            && model.session?.state != .paused
                    )
            }

            Divider()

            AtriumSectionLabel(title: "Quick capture", systemImage: "viewfinder")
            HStack(spacing: 8) {
                Button {
                    model.captureRegion()
                } label: {
                    Label("Region", systemImage: "rectangle.dashed")
                }
                .buttonStyle(AtriumSecondaryButtonStyle())

                Button {
                    model.captureElement()
                } label: {
                    Label("Element", systemImage: "scope")
                }
                .buttonStyle(AtriumSecondaryButtonStyle())
            }
            Text("⌥⌘A region  ·  ⌥⌘E element  ·  ⌥⌘P pins")
                .font(.system(size: 11))
                .foregroundStyle(AtriumCaptureTheme.muted)
        }
    }

    private var reviewAndPublishCard: some View {
        sectionCard(title: "Review & publish", systemImage: "checkmark.seal") {
            Label(reviewGuidance, systemImage: "arrow.right.circle.fill")
                .font(.system(size: 11, weight: .medium))
                .foregroundStyle(AtriumCaptureTheme.inkSoft)
                .padding(10)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(AtriumCaptureTheme.mint)
                .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))

            Button {
                model.flattenAndApprove()
            } label: {
                Label("Prepare publishable images", systemImage: "shield.checkered")
            }
            .buttonStyle(AtriumPrimaryButtonStyle())
            .disabled(model.session?.state != .review)

            HStack(spacing: 8) {
                TextField("Add a manual step", text: $model.manualInstruction)
                    .textFieldStyle(.roundedBorder)
                Button("Add") { model.insertManualStep() }
                    .buttonStyle(AtriumSecondaryButtonStyle())
            }
            .disabled(model.session?.state != .review)

            if !model.hasUnfinishedPublishJob {
                Button {
                    model.publishPrivateDraft()
                } label: {
                    Label("Create private Atrium draft", systemImage: "arrow.up.doc")
                }
                .buttonStyle(AtriumPrimaryButtonStyle())
                .disabled(model.session?.state != .publishable || !model.liveAtriumAvailable)
            }

            if let guidance = model.publishFailureGuidance,
               let failure = model.publishJob?.lastError {
                VStack(alignment: .leading, spacing: 8) {
                    Label(guidance, systemImage: "exclamationmark.arrow.triangle.2.circlepath")
                    Text("Atrium code: \(failure.code)")
                        .font(.system(.caption, design: .monospaced, weight: .semibold))
                    if let requestID = failure.requestID {
                        Text("Support ID: \(requestID)")
                            .font(.system(.caption, design: .monospaced))
                    }
                    if model.canRetryPublish {
                        Button("Retry Atrium publish") {
                            model.retryPublish()
                        }
                        .buttonStyle(AtriumSecondaryButtonStyle())
                    }
                }
                .font(.system(size: 11))
                .foregroundStyle(AtriumCaptureTheme.inkSoft)
                .padding(10)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(AtriumCaptureTheme.warningSoft)
                .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
            }

            if model.atriumConfigured && model.atriumAuthentication == .signedOut {
                VStack(alignment: .leading, spacing: 8) {
                    Text(
                        "Sign in with your district AI Studio account. You will return here automatically."
                    )
                        .font(.system(size: 11))
                        .foregroundStyle(AtriumCaptureTheme.inkSoft)
                    Button("Sign in to AI Studio") { model.signInToAtrium() }
                        .buttonStyle(AtriumSecondaryButtonStyle())
                }
            } else if model.atriumAuthentication == .signedIn {
                HStack {
                    Label("Connected to Atrium", systemImage: "checkmark.circle.fill")
                        .font(.system(size: 11))
                        .foregroundStyle(AtriumCaptureTheme.evergreen)
                    Spacer()
                    Button("Sign out") { model.signOutOfAtrium() }
                        .buttonStyle(AtriumSecondaryButtonStyle())
                }
            }

            if !model.atriumConfigured {
                Label {
                    Text("AI Studio sign-in is temporarily unavailable. Contact district support.")
                } icon: {
                    Image(systemName: "info.circle.fill")
                }
                .font(.system(size: 11))
                .foregroundStyle(AtriumCaptureTheme.inkSoft)
                .padding(10)
                .background(AtriumCaptureTheme.warningSoft)
                .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
            }

            if model.publishJob?.phase == .readyAsDraft {
                Button {
                    model.publishInternally()
                } label: {
                    Label("Publish draft internally", systemImage: "person.2.badge.gearshape")
                }
                .buttonStyle(AtriumSecondaryButtonStyle())
                .disabled(!model.liveAtriumAvailable)
            }

            Divider()

            Button {
                model.pinFirstReviewedImage()
            } label: {
                Label("Pin first reviewed image", systemImage: "pin")
            }
            .buttonStyle(AtriumSecondaryButtonStyle())
            .disabled(model.session?.state != .publishable)

            Menu {
                Button("Do not copy") { model.setClipboardRetention(.doNotCopy) }
                Button("Clear after 2 minutes") {
                    model.setClipboardRetention(.clearAfterSeconds(120))
                }
                Button("Keep until replaced") {
                    model.setClipboardRetention(.keepUntilReplaced)
                }
            } label: {
                Label("Clipboard retention", systemImage: "clipboard")
            }
            .menuStyle(.borderlessButton)
            .foregroundStyle(AtriumCaptureTheme.evergreen)
        }
    }

    private var reviewGuidance: String {
        guard let state = model.session?.state else {
            return "Start a recording or choose a quick capture. Stop the recording to review your steps."
        }
        switch state {
        case .recording, .paused:
            return "Finish the recording to review captured steps and remove private information."
        case .review:
            return "Review every step, add required redactions, then prepare publishable images."
        case .publishable where model.atriumAuthentication == .signedOut:
            return "Your reviewed images are ready. Sign in to AI Studio to create a private Atrium draft."
        case .publishable:
            return "Your reviewed images are ready to create as a private Atrium draft."
        case .submitted:
            return "Your private Atrium draft is ready. Publish it internally only when approved."
        case .archived:
            return "This capture is archived. Start a new recording when you are ready."
        }
    }

    private var pinsCard: some View {
        sectionCard(title: "Floating pins", systemImage: "pin.fill") {
            ForEach(model.pins, id: \.id) { pin in
                VStack(alignment: .leading, spacing: 8) {
                    Text(pin.title)
                        .font(.system(size: 13, weight: .semibold))
                        .foregroundStyle(AtriumCaptureTheme.ink)
                        .lineLimit(1)
                    HStack {
                        Toggle(
                            "Click-through",
                            isOn: Binding(
                                get: { pin.clickThrough },
                                set: { model.setPinClickThrough(pin, enabled: $0) }
                            )
                        )
                        .toggleStyle(.checkbox)
                        Spacer()
                        Button("Remove") { model.removePin(pin) }
                            .buttonStyle(AtriumDestructiveButtonStyle())
                    }
                    TextField(
                        "Group",
                        text: Binding(
                            get: { pin.groupID ?? "" },
                            set: { model.setPinGroup(pin, group: $0) }
                        )
                    )
                    .textFieldStyle(.roundedBorder)
                }
                .padding(12)
                .background(AtriumCaptureTheme.canvas)
                .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
            }
        }
    }

    private var guideWorkspace: some View {
        VStack(spacing: 0) {
            HStack(alignment: .center, spacing: 14) {
                VStack(alignment: .leading, spacing: 4) {
                    AtriumSectionLabel(title: "Visual guide", systemImage: "square.stack.3d.up")
                    Text(model.session?.title ?? "New visual guide")
                        .font(.system(size: 26, weight: .bold))
                        .foregroundStyle(AtriumCaptureTheme.ink)
                }
                Spacer()
                AtriumStatusPill(
                    label: "\(model.session?.steps.count ?? 0) steps",
                    recording: model.session?.state == .recording
                )
            }
            .padding(24)
            .background(AtriumCaptureTheme.panel)
            .overlay(alignment: .bottom) {
                Divider()
            }

            if let steps = model.session?.steps, !steps.isEmpty {
                ScrollView {
                    LazyVStack(spacing: 14) {
                        privacyNotice
                        ForEach(steps, id: \.stepID) { step in
                            stepCard(step)
                        }
                    }
                    .padding(24)
                }
                .background(AtriumCaptureTheme.canvas)
            } else {
                ContentUnavailableView {
                    Label("No captured steps", systemImage: "rectangle.dashed")
                } description: {
                    Text("Start recording or use a quick capture to build a visual guide.")
                }
                .foregroundStyle(AtriumCaptureTheme.inkSoft)
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                .background(AtriumCaptureTheme.canvas)
            }
        }
    }

    private var privacyNotice: some View {
        Label {
            Text("Screenshots remain local until redactions are flattened into new pixels.")
        } icon: {
            Image(systemName: "lock.shield.fill")
        }
        .font(.system(size: 12, weight: .medium))
        .foregroundStyle(AtriumCaptureTheme.evergreen)
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(12)
        .background(AtriumCaptureTheme.mint)
        .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
    }

    private func stepCard(_ step: StepElement) -> some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack(alignment: .top, spacing: 12) {
                Text("\(step.sequence + 1)")
                    .font(.system(size: 12, weight: .bold))
                    .foregroundStyle(.white)
                    .frame(width: 28, height: 28)
                    .background(AtriumCaptureTheme.evergreen)
                    .clipShape(Circle())

                VStack(alignment: .leading, spacing: 8) {
                    TextField(
                        "Instruction",
                        text: Binding(
                            get: {
                                step.instruction.editedText
                                    ?? step.instruction.generatedText
                            },
                            set: { model.updateInstruction(stepID: step.stepID, text: $0) }
                        )
                    )
                    .textFieldStyle(.plain)
                    .font(.system(size: 15, weight: .semibold))
                    .padding(.horizontal, 11)
                    .frame(minHeight: 38)
                    .background(AtriumCaptureTheme.canvas)
                    .clipShape(RoundedRectangle(cornerRadius: 9, style: .continuous))

                    HStack(spacing: 7) {
                        metadataPill(step.action.rawValue)
                        metadataPill(step.privacyReview.rawValue)
                    }
                }
            }

            HStack(spacing: 7) {
                annotationToolButton("Redact", kind: .redaction, step: step)
                annotationToolButton("Highlight", kind: .highlight, step: step)
                annotationToolButton("Rectangle", kind: .rectangle, step: step)
                annotationToolButton("Arrow", kind: .arrow, step: step)
                annotationToolButton("Text", kind: .text, step: step)
                Menu(moreMenuTitle(for: step)) {
                    Button(toolMenuTitle("Blur", kind: .blur, step: step)) {
                        selectTool(.blur, for: step)
                    }
                    Button(toolMenuTitle("Mosaic", kind: .mosaic, step: step)) {
                        selectTool(.mosaic, for: step)
                    }
                    Button("Crop center 80%") {
                        model.setCenterCrop(stepID: step.stepID)
                    }
                    Button("Reset crop") {
                        model.resetCrop(stepID: step.stepID)
                    }
                    .disabled(step.crop == nil)
                }
                .menuStyle(.borderlessButton)
                .foregroundStyle(AtriumCaptureTheme.evergreen)
            }
            .buttonStyle(AtriumSecondaryButtonStyle())
            .disabled(model.session?.state != .review)

            annotationGuidance(for: step)
            screenshotPreview(for: step)

            HStack(spacing: 7) {
                Button("Undo annotation") {
                    model.undoLastAnnotation(stepID: step.stepID)
                }
                .disabled((step.annotations ?? []).isEmpty)
                if step.crop != nil {
                    Button("Reset crop") {
                        model.resetCrop(stepID: step.stepID)
                    }
                }
                Spacer()
                Text("\((step.annotations ?? []).count) annotations")
                    .font(.system(size: 11, weight: .medium))
                    .foregroundStyle(AtriumCaptureTheme.muted)
            }
            .buttonStyle(AtriumSecondaryButtonStyle())
            .disabled(model.session?.state != .review)

            Divider()

            HStack(spacing: 7) {
                Button("Move up") { model.moveStep(stepID: step.stepID, offset: -1) }
                Button("Move down") { model.moveStep(stepID: step.stepID, offset: 1) }
                Button("Merge next") { model.mergeStepWithNext(stepID: step.stepID) }
                Spacer()
                Button("Delete") { model.deleteStep(stepID: step.stepID) }
                    .buttonStyle(AtriumDestructiveButtonStyle())
            }
            .buttonStyle(AtriumSecondaryButtonStyle())
            .disabled(model.session?.state != .review)
        }
        .padding(16)
        .atriumPanel()
    }

    @ViewBuilder
    private func screenshotPreview(for step: StepElement) -> some View {
        if let screenshot = model.screenshotImage(for: step) {
            AtriumScreenshotCanvas(
                image: screenshot,
                activeTool: selectedToolByStep[step.stepID],
                editing: model.session?.state == .review
                    && model.editableImageBounds(for: step) != nil,
                draftRect: Binding(
                    get: { draftRectByStep[step.stepID] },
                    set: { draftRectByStep[step.stepID] = $0 }
                )
            ) { start, end, previewSize in
                guard
                    let tool = selectedToolByStep[step.stepID],
                    let imageBounds = model.editableImageBounds(for: step),
                    let geometry = NativeAnnotationPlacement.geometry(
                        from: NativePoint(x: start.x, y: start.y),
                        to: NativePoint(x: end.x, y: end.y),
                        previewWidth: previewSize.width,
                        previewHeight: previewSize.height,
                        imageBounds: imageBounds
                    )
                else {
                    return
                }
                model.addAnnotation(
                    stepID: step.stepID,
                    kind: tool,
                    geometry: geometry,
                    arrowDirection: tool.rawValue == Kind.arrow.rawValue
                        ? NativeAnnotationPlacement.arrowDirection(
                            from: NativePoint(x: start.x, y: start.y),
                            to: NativePoint(x: end.x, y: end.y)
                        )
                        : nil,
                    text: annotationTextByStep[step.stepID]
                )
            }
                .accessibilityLabel("Screenshot for step \(step.sequence + 1)")
        } else {
            Label("Screenshot preview unavailable", systemImage: "photo.badge.exclamationmark")
                .font(.system(size: 12, weight: .medium))
                .foregroundStyle(AtriumCaptureTheme.muted)
                .frame(maxWidth: .infinity, minHeight: 120)
                .background(AtriumCaptureTheme.canvas)
                .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
        }
    }

    private func annotationToolButton(
        _ title: String,
        kind: Kind,
        step: StepElement
    ) -> some View {
        Button(toolMenuTitle(title, kind: kind, step: step)) {
            selectTool(kind, for: step)
        }
    }

    @ViewBuilder
    private func annotationGuidance(for step: StepElement) -> some View {
        if let tool = selectedToolByStep[step.stepID] {
            VStack(alignment: .leading, spacing: 8) {
                HStack {
                    Label(
                        "Drag over the screenshot to place \(toolDisplayName(tool)).",
                        systemImage: "cursorarrow.motionlines"
                    )
                    Spacer()
                    Button("Undo") {
                        model.undoLastAnnotation(stepID: step.stepID)
                    }
                    .buttonStyle(AtriumSecondaryButtonStyle())
                    .disabled((step.annotations ?? []).isEmpty)
                    Button("Done") {
                        selectedToolByStep[step.stepID] = nil
                        draftRectByStep[step.stepID] = nil
                    }
                    .buttonStyle(AtriumSecondaryButtonStyle())
                }
                if tool.rawValue == Kind.text.rawValue {
                    TextField(
                        "Annotation text",
                        text: Binding(
                            get: { annotationTextByStep[step.stepID] ?? "Annotation" },
                            set: { annotationTextByStep[step.stepID] = $0 }
                        )
                    )
                    .textFieldStyle(.roundedBorder)
                }
                if tool.rawValue == Kind.blur.rawValue
                    || tool.rawValue == Kind.mosaic.rawValue {
                    Text("Blur and mosaic are visual effects, not privacy redactions.")
                        .foregroundStyle(AtriumCaptureTheme.warning)
                } else if tool.rawValue == Kind.redaction.rawValue {
                    Text("Redaction is flattened last as opaque replacement pixels.")
                        .foregroundStyle(AtriumCaptureTheme.evergreen)
                }
            }
            .font(.system(size: 11, weight: .medium))
            .padding(10)
            .background(AtriumCaptureTheme.mint)
            .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
        } else {
            Text("Choose an edit tool, then drag directly over the screenshot.")
                .font(.system(size: 11, weight: .medium))
                .foregroundStyle(AtriumCaptureTheme.inkSoft)
        }
    }

    private func selectTool(_ kind: Kind, for step: StepElement) {
        if selectedToolByStep[step.stepID]?.rawValue == kind.rawValue {
            selectedToolByStep[step.stepID] = nil
            draftRectByStep[step.stepID] = nil
        } else {
            selectedToolByStep[step.stepID] = kind
        }
    }

    private func toolMenuTitle(_ title: String, kind: Kind, step: StepElement) -> String {
        selectedToolByStep[step.stepID]?.rawValue == kind.rawValue
            ? "✓ \(title)"
            : title
    }

    private func moreMenuTitle(for step: StepElement) -> String {
        guard let tool = selectedToolByStep[step.stepID],
              tool.rawValue == Kind.blur.rawValue || tool.rawValue == Kind.mosaic.rawValue
        else {
            return "More"
        }
        return "✓ \(toolDisplayName(tool))"
    }

    private func toolDisplayName(_ kind: Kind) -> String {
        kind.rawValue.replacingOccurrences(of: "_", with: " ")
    }

    private func permissionRow(
        _ label: String,
        _ state: NativePermissionState
    ) -> some View {
        HStack(spacing: 9) {
            Image(
                systemName: state == .granted
                    ? "checkmark.circle.fill"
                    : "exclamationmark.triangle.fill"
            )
            .foregroundStyle(
                state == .granted
                    ? AtriumCaptureTheme.evergreen
                    : AtriumCaptureTheme.warning
            )
            Text(label)
                .foregroundStyle(AtriumCaptureTheme.ink)
            Spacer()
            Text(permissionStateLabel(state))
                .font(.system(size: 11, weight: .semibold))
                .foregroundStyle(AtriumCaptureTheme.muted)
        }
    }

    private func permissionStateLabel(_ state: NativePermissionState) -> String {
        switch state {
        case .granted:
            "Granted"
        case .denied:
            "Blocked"
        case .notDetermined:
            "Approval needed"
        }
    }

    private func metadataPill(_ value: String) -> some View {
        Text(value.replacingOccurrences(of: "_", with: " "))
            .font(.system(size: 10, weight: .semibold))
            .foregroundStyle(AtriumCaptureTheme.evergreen)
            .textCase(.uppercase)
            .padding(.horizontal, 8)
            .padding(.vertical, 4)
            .background(AtriumCaptureTheme.mint)
            .clipShape(Capsule())
    }

    private func sectionCard<Content: View>(
        title: String,
        systemImage: String,
        @ViewBuilder content: () -> Content
    ) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            AtriumSectionLabel(title: title, systemImage: systemImage)
            content()
        }
        .padding(16)
        .frame(maxWidth: .infinity, alignment: .leading)
        .atriumPanel()
    }

    private var humanizedStatus: String {
        model.statusCode
            .split(separator: "_")
            .map { word in
                word.prefix(1).uppercased() + word.dropFirst().lowercased()
            }
            .joined(separator: " ")
    }
}

private struct AtriumScreenshotCanvas: View {
    let image: NSImage
    let activeTool: Kind?
    let editing: Bool
    @Binding var draftRect: CGRect?
    let onCommit: (CGPoint, CGPoint, CGSize) -> Void
    @State private var draftStart: CGPoint?
    @State private var draftEnd: CGPoint?

    var body: some View {
        GeometryReader { proxy in
            ZStack {
                Image(nsImage: image)
                    .resizable()
                    .interpolation(.medium)
                    .frame(width: proxy.size.width, height: proxy.size.height)

                if let draftRect {
                    draftOverlay(draftRect)
                }

                if editing, activeTool != nil {
                    Rectangle()
                        .fill(Color.clear)
                        .contentShape(Rectangle())
                        .gesture(
                            DragGesture(minimumDistance: 0, coordinateSpace: .local)
                                .onChanged { value in
                                    draftStart = clamped(value.startLocation, within: proxy.size)
                                    draftEnd = clamped(value.location, within: proxy.size)
                                    draftRect = normalizedRect(
                                        from: value.startLocation,
                                        to: value.location,
                                        within: proxy.size
                                    )
                                }
                                .onEnded { value in
                                    let start = clamped(value.startLocation, within: proxy.size)
                                    let end = clamped(value.location, within: proxy.size)
                                    draftRect = nil
                                    draftStart = nil
                                    draftEnd = nil
                                    onCommit(start, end, proxy.size)
                                }
                        )
                        .accessibilityLabel("Editable screenshot canvas")
                        .accessibilityHint("Drag to place the selected annotation.")
                }
            }
            .frame(width: proxy.size.width, height: proxy.size.height)
        }
        .aspectRatio(imageAspectRatio, contentMode: .fit)
        .frame(maxWidth: .infinity)
        .background(Color.black.opacity(0.04))
        .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
        .overlay {
            RoundedRectangle(cornerRadius: 12, style: .continuous)
                .stroke(
                    activeTool == nil
                        ? AtriumCaptureTheme.border
                        : AtriumCaptureTheme.evergreen,
                    lineWidth: activeTool == nil ? 1 : 2
                )
        }
    }

    @ViewBuilder
    private func draftOverlay(_ rect: CGRect) -> some View {
        if activeTool?.rawValue == Kind.arrow.rawValue,
           let draftStart,
           let draftEnd {
            arrowPath(from: draftStart, to: draftEnd)
            .stroke(Color.yellow, style: StrokeStyle(lineWidth: 4, lineCap: .round))
        } else {
            RoundedRectangle(cornerRadius: 3, style: .continuous)
                .fill(draftFill)
                .overlay {
                    RoundedRectangle(cornerRadius: 3, style: .continuous)
                        .stroke(draftStroke, lineWidth: 2)
                }
                .frame(width: max(1, rect.width), height: max(1, rect.height))
                .position(x: rect.midX, y: rect.midY)
        }
    }

    private func arrowPath(from start: CGPoint, to end: CGPoint) -> Path {
        let angle = atan2(end.y - start.y, end.x - start.x)
        let head = max(8, min(18, hypot(end.x - start.x, end.y - start.y) / 4))
        var path = Path()
        path.move(to: start)
        path.addLine(to: end)
        path.move(to: end)
        path.addLine(to: CGPoint(
            x: end.x - head * cos(angle - .pi / 6),
            y: end.y - head * sin(angle - .pi / 6)
        ))
        path.move(to: end)
        path.addLine(to: CGPoint(
            x: end.x - head * cos(angle + .pi / 6),
            y: end.y - head * sin(angle + .pi / 6)
        ))
        return path
    }

    private var imageAspectRatio: CGFloat {
        guard image.size.width > 0, image.size.height > 0 else { return 1 }
        return image.size.width / image.size.height
    }

    private var draftFill: Color {
        switch activeTool?.rawValue {
        case Kind.redaction.rawValue:
            Color.black.opacity(0.82)
        case Kind.highlight.rawValue:
            Color.yellow.opacity(0.28)
        case Kind.blur.rawValue, Kind.mosaic.rawValue:
            Color.gray.opacity(0.42)
        case Kind.text.rawValue:
            Color.black.opacity(0.68)
        default:
            Color.clear
        }
    }

    private var draftStroke: Color {
        activeTool?.rawValue == Kind.redaction.rawValue
            ? Color.white
            : Color.yellow
    }

    private func normalizedRect(from start: CGPoint, to end: CGPoint, within size: CGSize) -> CGRect {
        let clampedStart = clamped(start, within: size)
        let clampedEnd = clamped(end, within: size)
        return CGRect(
            x: min(clampedStart.x, clampedEnd.x),
            y: min(clampedStart.y, clampedEnd.y),
            width: abs(clampedEnd.x - clampedStart.x),
            height: abs(clampedEnd.y - clampedStart.y)
        )
    }

    private func clamped(_ point: CGPoint, within size: CGSize) -> CGPoint {
        CGPoint(
            x: min(max(0, point.x), size.width),
            y: min(max(0, point.y), size.height)
        )
    }
}
#endif
