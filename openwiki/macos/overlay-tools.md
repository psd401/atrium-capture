---
type: Component
title: Region Capture, Pins, and Multi-Display Tools
description: AppKit overlays implement region and focused-element capture, magnification, color sampling, floating pins, and Retina-correct geometry.
tags: [appkit, region-capture, pins, retina, multi-display]
---

# Region Capture, Pins, and Multi-Display Tools

One AppKit overlay is created per active Quartz display. Reverse-direction drags
normalize into a canonical top-left global point rectangle. ScreenCaptureKit
selects the display containing the region center and converts the rectangle
with independent X/Y pixel scales for Retina and mixed-density displays.

The region selector shows dimensions, a nearest-neighbor magnifier, and an sRGB
hex color sample. Global shortcuts capture a region, capture the focused
Accessibility element, and show or hide pins.

Reviewed derivatives can become always-on-top pins. Pin history is atomically
persisted, count/byte bounded, grouped, removable, and restart recoverable.
Pins support click-through, all-Spaces, and full-screen auxiliary behavior.
Clipboard retention is explicit and timed clearing checks ownership before
removing content.

Automated geometry and AppKit verifier tests supplement the manual display,
Space, permission-change, and full-screen matrix in
[`docs/macos-runbook.md`](../../docs/macos-runbook.md).
