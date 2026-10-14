# @atrium-capture/guide-writer

Builds the metadata-only request for the district "Capture Guide Writer"
assistant, validates its JSON reply by hand-checking the same shape and
limits as `contracts/guide-suggestion.schema.json` (this platform-neutral
package has no runtime Ajv), and converts the reply into editor commands.
A test pins the hand-coded limits to the schema so they cannot drift apart.
No DOM, Chrome, or AppKit. The request never contains typed values,
selectors, bounds, paths, asset ids, or image bytes.
