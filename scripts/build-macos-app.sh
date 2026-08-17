#!/bin/zsh
set -euo pipefail

repository_root="${0:A:h:h}"
package_path="$repository_root/apps/macos"
output_root="$repository_root/dist/macos"
architectures="${ATRIUM_CAPTURE_ARCHITECTURES:-}"
production_bundle="${ATRIUM_CAPTURE_PRODUCTION_BUNDLE:-0}"

if [[ "$production_bundle" != "0" && "$production_bundle" != "1" ]]; then
  echo "ATRIUM_CAPTURE_PRODUCTION_BUNDLE must be 0 or 1." >&2
  exit 1
fi
if [[ "$production_bundle" == "1" ]]; then
  if [[ -z "${ATRIUM_CAPTURE_CODESIGN_IDENTITY:-}" \
    || "${ATRIUM_CAPTURE_CODESIGN_IDENTITY:-}" == "-" ]]; then
    echo "The production bundle identity requires a stable Apple signing identity." >&2
    exit 1
  fi
  app_path="$output_root/Atrium Capture.app"
  expected_bundle_identifier="org.psd401.AtriumCapture"
  expected_display_name="Atrium Capture"
else
  app_path="$output_root/Atrium Capture Local.app"
  expected_bundle_identifier="org.psd401.AtriumCapture.Local"
  expected_display_name="Atrium Capture Local"
  legacy_production_path="$output_root/Atrium Capture.app"
  if [[ -e "$legacy_production_path" || -L "$legacy_production_path" ]]; then
    echo "Default local assembly found a legacy production-named app:" >&2
    echo "$legacy_production_path" >&2
    echo "Move or remove that build artifact first so it cannot be mistaken for the signed production app." >&2
    exit 1
  fi
fi

if [[ -z "${SDKROOT:-}" && -d /Library/Developer/CommandLineTools/SDKs/MacOSX15.4.sdk ]]; then
  export SDKROOT=/Library/Developer/CommandLineTools/SDKs/MacOSX15.4.sdk
fi
export CLANG_MODULE_CACHE_PATH="${CLANG_MODULE_CACHE_PATH:-/private/tmp/atrium-capture-clang-cache}"
export SWIFTPM_MODULECACHE_OVERRIDE="${SWIFTPM_MODULECACHE_OVERRIDE:-/private/tmp/atrium-capture-swift-cache}"

build_arguments=(--disable-sandbox --package-path "$package_path" -c release)
if [[ -n "$architectures" ]]; then
  for architecture in ${(z)architectures}; do
    build_arguments+=(--arch "$architecture")
  done
fi

swift build "${build_arguments[@]}"
binary_path="$(swift build "${build_arguments[@]}" --show-bin-path)"
# SwiftPM's multi-architecture backend can leave a linker signature that no
# longer covers the lipo-combined binary. Apply a local signature before running
# the verifier and native host; the bundled copies are signed again below.
codesign --force --sign - "$binary_path/AtriumCaptureMacVerifier"
codesign --force --sign - "$binary_path/AtriumCaptureNativeHost"
"$binary_path/AtriumCaptureMacVerifier"
node "$repository_root/scripts/verify-native-host.mjs" "$binary_path/AtriumCaptureNativeHost"

rm -rf "$app_path"
mkdir -p "$app_path/Contents/MacOS" "$app_path/Contents/Helpers" "$app_path/Contents/Resources"
cp "$package_path/App/Info.plist" "$app_path/Contents/Info.plist"
cp "$binary_path/AtriumCaptureMacApp" "$app_path/Contents/MacOS/AtriumCaptureMacApp"
cp "$binary_path/AtriumCaptureNativeHost" "$app_path/Contents/Helpers/AtriumCaptureNativeHost"
cp "$package_path/App/Assets/AtriumCapture.icns" "$app_path/Contents/Resources/AtriumCapture.icns"
if [[ "$production_bundle" != "1" ]]; then
  plutil -replace CFBundleIdentifier \
    -string org.psd401.AtriumCapture.Local \
    "$app_path/Contents/Info.plist"
  plutil -replace CFBundleDisplayName \
    -string "Atrium Capture Local" \
    "$app_path/Contents/Info.plist"
  plutil -replace CFBundleName \
    -string "Atrium Capture Local" \
    "$app_path/Contents/Info.plist"
fi
plutil -lint "$app_path/Contents/Info.plist"
actual_bundle_identifier="$(
  plutil -extract CFBundleIdentifier raw "$app_path/Contents/Info.plist"
)"
actual_display_name="$(
  plutil -extract CFBundleDisplayName raw "$app_path/Contents/Info.plist"
)"
oauth_redirect_scheme="$(
  plutil -extract CFBundleURLTypes.0.CFBundleURLSchemes.0 raw \
    "$app_path/Contents/Info.plist"
)"
if [[ "$actual_bundle_identifier" != "$expected_bundle_identifier" \
  || "$actual_display_name" != "$expected_display_name" ]]; then
  echo "Mac app bundle identity does not match its build mode." >&2
  exit 1
fi
if [[ "$oauth_redirect_scheme" != "org.psd401.atrium-capture" ]]; then
  echo "Mac app OAuth callback scheme does not match the registered Atrium client." >&2
  exit 1
fi
icon_file="$(plutil -extract CFBundleIconFile raw "$app_path/Contents/Info.plist")"
if [[ "$icon_file" != "AtriumCapture.icns" || ! -f "$app_path/Contents/Resources/$icon_file" ]]; then
  echo "Mac app icon is missing or does not match CFBundleIconFile." >&2
  exit 1
fi

if [[ -n "${ATRIUM_CAPTURE_CODESIGN_IDENTITY:-}" ]]; then
  codesign_arguments=(
    --force
    --deep
    --sign "$ATRIUM_CAPTURE_CODESIGN_IDENTITY"
    --options runtime
  )
  if [[ "$ATRIUM_CAPTURE_CODESIGN_IDENTITY" == Developer\ ID\ Application:* ]]; then
    codesign_arguments+=(--timestamp)
  fi
  codesign "${codesign_arguments[@]}" "$app_path"
  codesign --verify --deep --strict "$app_path"
elif [[ "${ATRIUM_CAPTURE_ADHOC_SIGN:-1}" == "1" ]]; then
  codesign --force --deep --sign - --options runtime "$app_path"
  codesign --verify --deep --strict "$app_path"
fi

echo "$app_path"
