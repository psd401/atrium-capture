#if os(macOS)
import AtriumCaptureContracts
import AtriumCaptureCore
import AtriumCaptureMacPlatform
import SwiftUI

struct AtriumCaptureWorkspaceView: View {
    @ObservedObject var model: CaptureAppModel

    var body: some View {
        NavigationSplitView {
            ScrollView {
                VStack(alignment: .leading, spacing: 16) {
                    brandHeader
                    permissionCard
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
            if captureAccessReady {
                Label("Capture access is ready.", systemImage: "checkmark.circle.fill")
                    .font(.system(size: 11, weight: .medium))
                    .foregroundStyle(AtriumCaptureTheme.evergreen)
            } else {
                Text(
                    "macOS requires both permissions to record steps. Approve Atrium Capture, then quit and reopen the app if a permission still shows as needed."
                )
                .font(.system(size: 11))
                .foregroundStyle(AtriumCaptureTheme.inkSoft)

                Button("Grant capture access") { model.requestPermissions() }
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

            Button {
                model.publishPrivateDraft()
            } label: {
                Label("Create private Atrium draft", systemImage: "arrow.up.doc")
            }
            .buttonStyle(AtriumPrimaryButtonStyle())
            .disabled(model.session?.state != .publishable || !model.liveAtriumAvailable)

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

            Divider()

            HStack(spacing: 7) {
                Button("Redact") {
                    model.addAnnotation(stepID: step.stepID, kind: .redaction)
                }
                Button("Highlight") {
                    model.addAnnotation(stepID: step.stepID, kind: .highlight)
                }
                Button("Rectangle") {
                    model.addAnnotation(stepID: step.stepID, kind: .rectangle)
                }
                Button("Arrow") {
                    model.addAnnotation(stepID: step.stepID, kind: .arrow)
                }
                Button("Text") {
                    model.addAnnotation(stepID: step.stepID, kind: .text)
                }
                Menu("More") {
                    Button("Blur") {
                        model.addAnnotation(stepID: step.stepID, kind: .blur)
                    }
                    Button("Mosaic") {
                        model.addAnnotation(stepID: step.stepID, kind: .mosaic)
                    }
                    Button("Crop center 80%") {
                        model.setCenterCrop(stepID: step.stepID)
                    }
                }
                .menuStyle(.borderlessButton)
                .foregroundStyle(AtriumCaptureTheme.evergreen)
            }
            .buttonStyle(AtriumSecondaryButtonStyle())
            .disabled(model.session?.state != .review)

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
#endif
