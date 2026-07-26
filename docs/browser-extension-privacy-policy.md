# Atrium Capture browser extension privacy policy

Effective date: July 25, 2026

Atrium Capture is an internal Peninsula School District browser extension that
helps authorized staff record, review, permanently redact, and publish visual
workflow guides to the district's AI Studio/Atrium workspace. This policy
applies to the Chrome extension. It does not replace the district policies that
govern employee accounts, records, or AI Studio.

## What the extension processes

Atrium Capture processes the following data only during a recording that a user
explicitly starts:

- screenshots of the visible browser tab;
- meaningful user actions such as clicks, navigation, selection, submit, and
  generic input intent;
- bounded page context such as an accessible control name, page title, and
  current origin or path when district policy permits it;
- the user's guide title, instructions, annotations, and redactions; and
- AI Studio OAuth tokens needed to create or update the user's Atrium guide.

The extension does not read or retain password-field values. Ordinary typed
values are represented as generic instructions such as “Enter the requested
value,” not stored literally. It does not read cookies, browser-history storage,
page local storage, network traffic, or raw page HTML.

## How the data is used

Capture data is used only to let the author build the visual guide they
requested. Screenshots and guide content remain on the local device until the
author reviews the steps, completes the mandatory privacy review, and explicitly
creates an Atrium draft.

Before an image can be published, Atrium Capture flattens approved annotations
and opaque redactions into new pixels and strips image metadata. Only those
reviewed derivatives may enter the durable publishing outbox. Unredacted source
images are never uploaded.

OAuth tokens are used only for direct communication with Peninsula School
District AI Studio/Atrium. They stay in trusted extension storage and are never
provided to a recorded webpage, content script, native message, diagnostic
export, or log.

## Sharing and transfers

Atrium Capture does not sell user data. It does not use data for advertising,
creditworthiness, unrelated profiling, or any purpose unrelated to creating and
publishing the requested guide.

When the author explicitly submits a reviewed guide, approved guide content is
sent directly to Peninsula School District AI Studio/Atrium. Reviewed images are
uploaded directly to the storage destination issued by Atrium. The extension
does not send capture content to an analytics provider, advertising service,
external AI provider, private screenshot host, or crash-reporting service.

## Storage and retention

Recording state, screenshots, event receipts, and publishing jobs are stored
locally in extension-owned IndexedDB so work can recover safely after a browser
or Manifest V3 service-worker restart. District-managed policy can limit
approved sites, URL retention, step count, image bytes, and raw-image retention.

The default policy deletes raw source images after publishable derivatives are
prepared. A managed policy may retain raw images locally until successful
submission, but raw images remain ineligible for upload. Users can delete all
extension-owned local capture data from Support diagnostics. Removing the
extension also removes extension-owned browser storage according to Chrome's
platform behavior.

Atrium retains submitted guides according to Peninsula School District records,
access, and retention policies.

## Security and user control

- Recording starts only after an explicit user action and remains visibly
  indicated.
- District-managed origin policy is checked before recording listeners attach.
- Password and sensitive autocomplete fields are rejected before persistence.
- Every content-script message is schema validated by the trusted service
  worker.
- New Atrium objects are private drafts by default. Internal publication is a
  separate explicit action.
- Operational diagnostics contain bounded counts and fixed health codes, not
  capture text, URLs, identifiers, tokens, or pixels, and are never transmitted
  automatically.

Users can pause or stop recording, remove or reorder steps, edit instructions,
redact screenshots, discard guides, sign out of AI Studio, revoke local data,
and choose whether to create or internally publish an Atrium guide.

## Children and education records

Atrium Capture is deployed for authorized district use, not offered as a
consumer service for children. Users must follow district policy and must not
record student, staff, or other sensitive information unless their work
authorizes it and the final guide has been reviewed and appropriately redacted.

## Changes and contact

Material changes to capture, use, sharing, or retention practices require an
updated policy and Chrome Web Store disclosure before release.

Questions about this extension or policy may be directed to Peninsula School
District Technology Services at
`tsd-developers-psd@edtools.psd401.net`.
