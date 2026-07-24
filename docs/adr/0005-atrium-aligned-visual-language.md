# ADR 0005: Atrium-aligned cross-platform visual language

- Status: accepted
- Date: 2026-07-24

## Context

The browser side panel and native Mac companion are entry points into Atrium, but they originally presented unrelated generic controls: a blue web administration palette in Chrome and unstructured default SwiftUI controls on macOS. Capture must feel at home beside Atrium while remaining its own task-focused product. The implementation also cannot copy a distinctive page composition or commit a production screenshot as an asset or fixture.

## Decision

- Use the current Atrium product as a color, density, shape, and hierarchy reference only. Atrium Capture retains its recorder/review workspace layouts and does not reproduce the content-library screen.
- Use semantic visual roles on both platforms: deep evergreen primary actions, mint selection and review states, a warm neutral canvas, white panels, charcoal text, quiet gray metadata, amber warnings, and restrained red for destructive actions and active recording.
- Browser tokens live as CSS custom properties in the side panel. Native equivalents live as SwiftUI `Color` roles and reusable button, panel, brand-mark, status-pill, and section-label components. These presentation tokens are not capture contracts and do not enter normalized data.
- Prefer system typography, native controls, SF Symbols on macOS, and code-native shapes. No screenshot, font, icon pack, or production Atrium asset is bundled.
- Make privacy posture part of the primary hierarchy: both clients state that work is private by default and reviewed before publishing; the Mac review workspace also keeps the irreversible-flattening boundary visible.
- Preserve accessible focus states, text labels in addition to color, disabled-state clarity, and reduced-motion behavior. Primary and destructive colors must retain readable text contrast.

## Consequences

The two clients now feel related to Atrium without depending on Atrium frontend code or assets. Browser and native presentations remain independently implemented so each follows its platform conventions. The small duplicated palette is intentional presentation configuration; changes to a semantic role should be reviewed on both clients together. Production screenshots remain design references outside the repository and never become test data.
