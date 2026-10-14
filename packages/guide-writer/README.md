# @atrium-capture/guide-writer

Builds the metadata-only request for the district "Capture Guide Writer"
assistant, validates its JSON reply against `contracts/guide-suggestion.schema.json`,
and converts the reply into editor commands. No DOM, Chrome, or AppKit.
The request never contains typed values, selectors, bounds, paths, asset
ids, or image bytes.
