#!/bin/zsh
set -euo pipefail

repository_root="${0:A:h:h}"
package_path="$repository_root/apps/macos"
output_root="$repository_root/dist/macos"
app_path="$output_root/Atrium Capture.app"

if [[ -z "${SDKROOT:-}" && -d /Library/Developer/CommandLineTools/SDKs/MacOSX15.4.sdk ]]; then
  export SDKROOT=/Library/Developer/CommandLineTools/SDKs/MacOSX15.4.sdk
fi
export CLANG_MODULE_CACHE_PATH="${CLANG_MODULE_CACHE_PATH:-/private/tmp/atrium-capture-clang-cache}"
export SWIFTPM_MODULECACHE_OVERRIDE="${SWIFTPM_MODULECACHE_OVERRIDE:-/private/tmp/atrium-capture-swift-cache}"

swift build --disable-sandbox --package-path "$package_path" -c release
binary_path="$(swift build --disable-sandbox --package-path "$package_path" -c release --show-bin-path)"
"$binary_path/AtriumCaptureMacVerifier"
node "$repository_root/scripts/verify-native-host.mjs" "$binary_path/AtriumCaptureNativeHost"

rm -rf "$app_path"
mkdir -p "$app_path/Contents/MacOS" "$app_path/Contents/Helpers" "$app_path/Contents/Resources"
cp "$package_path/App/Info.plist" "$app_path/Contents/Info.plist"
cp "$binary_path/AtriumCaptureMacApp" "$app_path/Contents/MacOS/AtriumCaptureMacApp"
cp "$binary_path/AtriumCaptureNativeHost" "$app_path/Contents/Helpers/AtriumCaptureNativeHost"
cp "$package_path/App/Assets/AtriumCapture.icns" "$app_path/Contents/Resources/AtriumCapture.icns"
plutil -lint "$app_path/Contents/Info.plist"
icon_file="$(plutil -extract CFBundleIconFile raw "$app_path/Contents/Info.plist")"
if [[ "$icon_file" != "AtriumCapture.icns" || ! -f "$app_path/Contents/Resources/$icon_file" ]]; then
  echo "Mac app icon is missing or does not match CFBundleIconFile." >&2
  exit 1
fi

if [[ "${ATRIUM_CAPTURE_ADHOC_SIGN:-1}" == "1" ]]; then
  codesign --force --deep --sign - --options runtime "$app_path"
  codesign --verify --deep --strict "$app_path"
fi

echo "$app_path"
