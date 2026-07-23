#!/bin/zsh
set -euo pipefail

repository_root="${0:A:h:h}"
app_path="${1:-$repository_root/dist/macos/Atrium Capture.app}"
browser_name="${2:-chrome}"
extension_id="${3:-jldnpmcpimhabiphcglkbgmbffpoocpo}"
helper_path="$app_path/Contents/Helpers/AtriumCaptureNativeHost"

if [[ ! -x "$helper_path" ]]; then
  echo "Native helper not found at $helper_path" >&2
  exit 1
fi

case "$browser_name" in
  chrome)
    destination_dir="$HOME/Library/Application Support/Google/Chrome/NativeMessagingHosts"
    ;;
  chrome-for-testing)
    destination_dir="$HOME/Library/Application Support/Google/ChromeForTesting/NativeMessagingHosts"
    ;;
  chromium)
    destination_dir="$HOME/Library/Application Support/Chromium/NativeMessagingHosts"
    ;;
  *)
    echo "Browser must be chrome, chrome-for-testing, or chromium." >&2
    exit 1
    ;;
esac

mkdir -p "$destination_dir"
ATRIUM_NATIVE_TEMPLATE="$repository_root/apps/macos/NativeMessaging/org.psd401.atrium_capture.json.in" \
ATRIUM_NATIVE_DESTINATION="$destination_dir/org.psd401.atrium_capture.json" \
ATRIUM_NATIVE_HELPER="$helper_path" \
ATRIUM_EXTENSION_ID="$extension_id" \
node -e '
  const fs = require("node:fs");
  const template = fs.readFileSync(process.env.ATRIUM_NATIVE_TEMPLATE, "utf8");
  const output = template
    .replace("__ABSOLUTE_HELPER_PATH__", process.env.ATRIUM_NATIVE_HELPER)
    .replace("__EXTENSION_ID__", process.env.ATRIUM_EXTENSION_ID);
  JSON.parse(output);
  fs.writeFileSync(process.env.ATRIUM_NATIVE_DESTINATION, output, { mode: 0o600 });
'

echo "$destination_dir/org.psd401.atrium_capture.json"
