#if os(macOS)
import SwiftUI

enum AtriumCaptureTheme {
    static let ink = Color(red: 0.09, green: 0.13, blue: 0.12)
    static let inkSoft = Color(red: 0.28, green: 0.32, blue: 0.30)
    static let muted = Color(red: 0.40, green: 0.45, blue: 0.43)
    static let evergreen = Color(red: 0.05, green: 0.23, blue: 0.21)
    static let evergreenHover = Color(red: 0.09, green: 0.30, blue: 0.27)
    static let mint = Color(red: 0.91, green: 0.95, blue: 0.94)
    static let mintStrong = Color(red: 0.84, green: 0.91, blue: 0.89)
    static let canvas = Color(red: 0.96, green: 0.97, blue: 0.96)
    static let panel = Color.white
    static let border = Color(red: 0.87, green: 0.89, blue: 0.88)
    static let warning = Color(red: 0.54, green: 0.34, blue: 0.07)
    static let warningSoft = Color(red: 1.00, green: 0.97, blue: 0.91)
    static let danger = Color(red: 0.55, green: 0.15, blue: 0.21)
    static let dangerSoft = Color(red: 0.98, green: 0.93, blue: 0.94)
}

struct AtriumPrimaryButtonStyle: ButtonStyle {
    @Environment(\.isEnabled) private var isEnabled

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.system(size: 13, weight: .semibold))
            .lineLimit(1)
            .minimumScaleFactor(0.8)
            .allowsTightening(true)
            .foregroundStyle(.white)
            .padding(.horizontal, 14)
            .frame(minHeight: 34)
            .background(
                RoundedRectangle(cornerRadius: 10, style: .continuous)
                    .fill(
                        configuration.isPressed
                            ? AtriumCaptureTheme.evergreenHover
                            : AtriumCaptureTheme.evergreen
                    )
            )
            .opacity(isEnabled ? 1 : 0.45)
    }
}

struct AtriumSecondaryButtonStyle: ButtonStyle {
    @Environment(\.isEnabled) private var isEnabled

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.system(size: 13, weight: .semibold))
            .lineLimit(1)
            .minimumScaleFactor(0.8)
            .allowsTightening(true)
            .foregroundStyle(AtriumCaptureTheme.evergreen)
            .padding(.horizontal, 12)
            .frame(minHeight: 32)
            .background(
                RoundedRectangle(cornerRadius: 9, style: .continuous)
                    .fill(
                        configuration.isPressed
                            ? AtriumCaptureTheme.mintStrong
                            : AtriumCaptureTheme.mint
                    )
            )
            .overlay(
                RoundedRectangle(cornerRadius: 9, style: .continuous)
                    .stroke(AtriumCaptureTheme.border, lineWidth: 1)
            )
            .opacity(isEnabled ? 1 : 0.45)
    }
}

struct AtriumDestructiveButtonStyle: ButtonStyle {
    @Environment(\.isEnabled) private var isEnabled

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.system(size: 13, weight: .semibold))
            .lineLimit(1)
            .minimumScaleFactor(0.8)
            .allowsTightening(true)
            .foregroundStyle(AtriumCaptureTheme.danger)
            .padding(.horizontal, 12)
            .frame(minHeight: 32)
            .background(
                RoundedRectangle(cornerRadius: 9, style: .continuous)
                    .fill(
                        configuration.isPressed
                            ? AtriumCaptureTheme.dangerSoft.opacity(0.72)
                            : AtriumCaptureTheme.dangerSoft
                    )
            )
            .overlay(
                RoundedRectangle(cornerRadius: 9, style: .continuous)
                    .stroke(AtriumCaptureTheme.danger.opacity(0.18), lineWidth: 1)
            )
            .opacity(isEnabled ? 1 : 0.45)
    }
}

struct AtriumPanelModifier: ViewModifier {
    func body(content: Content) -> some View {
        content
            .background(AtriumCaptureTheme.panel)
            .clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: 16, style: .continuous)
                    .stroke(AtriumCaptureTheme.border, lineWidth: 1)
            )
            .shadow(color: AtriumCaptureTheme.evergreen.opacity(0.06), radius: 8, y: 2)
    }
}

extension View {
    func atriumPanel() -> some View {
        modifier(AtriumPanelModifier())
    }
}

struct AtriumBrandMark: View {
    var body: some View {
        Text("A")
            .font(.system(size: 18, weight: .bold, design: .rounded))
            .foregroundStyle(.white)
            .frame(width: 44, height: 44)
            .background(AtriumCaptureTheme.evergreen)
            .clipShape(RoundedRectangle(cornerRadius: 13, style: .continuous))
    }
}

struct AtriumStatusPill: View {
    let label: String
    var recording = false

    var body: some View {
        HStack(spacing: 7) {
            Circle()
                .fill(recording ? Color.red : AtriumCaptureTheme.muted)
                .frame(width: 7, height: 7)
            Text(label)
                .font(.system(size: 12, weight: .semibold))
        }
        .foregroundStyle(AtriumCaptureTheme.evergreen)
        .padding(.horizontal, 10)
        .padding(.vertical, 6)
        .background(AtriumCaptureTheme.mint)
        .clipShape(Capsule())
    }
}

struct AtriumSectionLabel: View {
    let title: String
    var systemImage: String?

    var body: some View {
        HStack(spacing: 7) {
            if let systemImage {
                Image(systemName: systemImage)
            }
            Text(title)
        }
        .font(.system(size: 11, weight: .bold))
        .tracking(0.9)
        .foregroundStyle(AtriumCaptureTheme.muted)
        .textCase(.uppercase)
    }
}
#endif
