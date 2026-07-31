#!/bin/zsh
set -euo pipefail

repository_root="${0:A:h:h}"
output_root="$repository_root/dist/macos"
app_path="$output_root/Atrium Capture.app"
info_plist="$repository_root/apps/macos/App/Info.plist"
package_identifier="org.psd401.AtriumCapture.pkg"
bundle_identifier="org.psd401.AtriumCapture"
extension_id="eomlblaiglafndhplfhilmdcaofhkkbj"
require_distribution="${ATRIUM_CAPTURE_REQUIRE_DISTRIBUTION:-0}"
app_identity="${ATRIUM_CAPTURE_CODESIGN_IDENTITY:-}"
installer_identity="${ATRIUM_CAPTURE_INSTALLER_IDENTITY:-}"
notary_profile="${ATRIUM_CAPTURE_NOTARY_PROFILE:-}"
notary_key_path="${ATRIUM_CAPTURE_NOTARY_KEY_PATH:-}"
notary_key_id="${ATRIUM_CAPTURE_NOTARY_KEY_ID:-}"
notary_issuer_id="${ATRIUM_CAPTURE_NOTARY_ISSUER_ID:-}"
expected_team_id="${ATRIUM_CAPTURE_EXPECTED_TEAM_ID:-87DL7L9GU6}"

notary_credentials_available=0
if [[ -n "$notary_profile" || (
  -n "$notary_key_path" && -n "$notary_key_id" && -n "$notary_issuer_id"
) ]]; then
  notary_credentials_available=1
fi

submit_for_notarization() {
  local submission_path="$1"
  if [[ -n "$notary_profile" ]]; then
    xcrun notarytool submit "$submission_path" \
      --keychain-profile "$notary_profile" \
      --wait
  else
    xcrun notarytool submit "$submission_path" \
      --key "$notary_key_path" \
      --key-id "$notary_key_id" \
      --issuer "$notary_issuer_id" \
      --wait
  fi
}

assert_distribution_team() {
  local artifact_description="$1"
  local actual_team_id="$2"
  if [[ "$require_distribution" == "1" && "$actual_team_id" != "$expected_team_id" ]]; then
    echo "$artifact_description was signed by the wrong team." >&2
    echo "Expected TeamIdentifier: $expected_team_id" >&2
    echo "Actual TeamIdentifier: ${actual_team_id:-<missing>}" >&2
    exit 1
  fi
}

version="$(plutil -extract CFBundleShortVersionString raw "$info_plist")"
build_number="$(plutil -extract CFBundleVersion raw "$info_plist")"
artifact_name="Atrium-Capture-$version.pkg"
artifact_path="$output_root/$artifact_name"
checksum_path="$artifact_path.sha256"
manifest_path="$output_root/macos-package-manifest.json"

if [[ ! "$version" =~ '^[0-9]+\.[0-9]+\.[0-9]+$' ]]; then
  echo "CFBundleShortVersionString must be a three-part semantic version." >&2
  exit 1
fi
if [[ -n "${ATRIUM_CAPTURE_EXPECTED_TAG:-}" && "$ATRIUM_CAPTURE_EXPECTED_TAG" != "v$version" ]]; then
  echo "Tag $ATRIUM_CAPTURE_EXPECTED_TAG does not match app version v$version." >&2
  exit 1
fi

root_version="$(
  node -e 'process.stdout.write(require(process.argv[1]).version)' \
    "$repository_root/package.json"
)"
browser_version="$(
  node -e 'process.stdout.write(require(process.argv[1]).version)' \
    "$repository_root/apps/browser-extension/package.json"
)"
if [[ "$root_version" != "$version" || "$browser_version" != "$version" ]]; then
  echo "Root, browser, and Mac release versions must all equal $version." >&2
  exit 1
fi

if [[ "$require_distribution" != "0" && "$require_distribution" != "1" ]]; then
  echo "ATRIUM_CAPTURE_REQUIRE_DISTRIBUTION must be 0 or 1." >&2
  exit 1
fi
if [[ "$require_distribution" == "1" ]]; then
  if [[ "$app_identity" != Developer\ ID\ Application:* ]]; then
    echo "A Developer ID Application identity is required for distribution." >&2
    exit 1
  fi
  if [[ "$installer_identity" != Developer\ ID\ Installer:* ]]; then
    echo "A Developer ID Installer identity is required for distribution." >&2
    exit 1
  fi
  if [[ "$notary_credentials_available" != "1" ]]; then
    echo "Notarization credentials are required for distribution." >&2
    exit 1
  fi
fi

release_architectures="${ATRIUM_CAPTURE_ARCHITECTURES:-arm64 x86_64}"
if [[ -n "$app_identity" ]]; then
  ATRIUM_CAPTURE_ARCHITECTURES="$release_architectures" \
  ATRIUM_CAPTURE_CODESIGN_IDENTITY="$app_identity" \
    "$repository_root/scripts/build-macos-app.sh"
else
  ATRIUM_CAPTURE_ARCHITECTURES="$release_architectures" \
    "$repository_root/scripts/build-macos-app.sh"
fi

codesign --verify --deep --strict "$app_path"
for executable in \
  "$app_path/Contents/MacOS/AtriumCaptureMacApp" \
  "$app_path/Contents/Helpers/AtriumCaptureNativeHost"; do
  executable_architectures=" $(lipo -archs "$executable") "
  for required_architecture in arm64 x86_64; do
    if [[ "$executable_architectures" != *" $required_architecture "* ]]; then
      echo "$executable is missing the $required_architecture architecture." >&2
      exit 1
    fi
  done
done
app_signature="ad_hoc"
app_signature_details="$(codesign -dvv "$app_path" 2>&1)"
if [[ "$app_signature_details" == *"Authority=Developer ID Application:"* ]]; then
  app_signature="developer_id_application"
elif [[ "$app_signature_details" == *"Authority=Apple Development:"* ]]; then
  app_signature="apple_development"
fi
app_team_id="$(
  printf '%s\n' "$app_signature_details" |
    awk -F= '/^TeamIdentifier=/{print $2; exit}'
)"
if [[ "$require_distribution" == "1" && "$app_signature" != "developer_id_application" ]]; then
  echo "The assembled app is not signed with Developer ID Application." >&2
  exit 1
fi
assert_distribution_team "The assembled app" "$app_team_id"

temporary_root="$(mktemp -d /private/tmp/atrium-capture-package.XXXXXX)"
trap 'rm -rf "$temporary_root"' EXIT
app_notarized=false
app_stapled=false
if [[ "$notary_credentials_available" == "1" ]]; then
  app_notary_zip="$temporary_root/Atrium-Capture.app.zip"
  ditto -c -k --keepParent "$app_path" "$app_notary_zip"
  submit_for_notarization "$app_notary_zip"
  app_notarized=true
  xcrun stapler staple "$app_path"
  xcrun stapler validate "$app_path"
  app_stapled=true
fi

payload_root="$temporary_root/payload"
component_path="$temporary_root/AtriumCapture-component.pkg"
unsigned_product_path="$temporary_root/$artifact_name"
mkdir -p \
  "$payload_root/Applications" \
  "$payload_root/Library/Google/Chrome/NativeMessagingHosts"
ditto --norsrc --noextattr "$app_path" "$payload_root/Applications/Atrium Capture.app"

ATRIUM_NATIVE_TEMPLATE="$repository_root/apps/macos/NativeMessaging/org.psd401.atrium_capture.json.in" \
ATRIUM_NATIVE_DESTINATION="$payload_root/Library/Google/Chrome/NativeMessagingHosts/org.psd401.atrium_capture.json" \
ATRIUM_NATIVE_HELPER="/Applications/Atrium Capture.app/Contents/Helpers/AtriumCaptureNativeHost" \
ATRIUM_EXTENSION_ID="$extension_id" \
node -e '
  const fs = require("node:fs");
  const template = fs.readFileSync(process.env.ATRIUM_NATIVE_TEMPLATE, "utf8");
  const output = template
    .replace("__ABSOLUTE_HELPER_PATH__", process.env.ATRIUM_NATIVE_HELPER)
    .replace("__EXTENSION_ID__", process.env.ATRIUM_EXTENSION_ID);
  JSON.parse(output);
  fs.writeFileSync(process.env.ATRIUM_NATIVE_DESTINATION, output, { mode: 0o644 });
'
xattr -cr "$payload_root"

pkgbuild \
  --root "$payload_root" \
  --identifier "$package_identifier" \
  --version "$version" \
  --install-location / \
  "$component_path"

if [[ -n "$installer_identity" ]]; then
  productbuild \
    --package "$component_path" \
    --sign "$installer_identity" \
    "$unsigned_product_path"
else
  productbuild --package "$component_path" "$unsigned_product_path"
fi

installer_signature="unsigned"
installer_team_id=""
if [[ -n "$installer_identity" ]]; then
  installer_signature_details="$(pkgutil --check-signature "$unsigned_product_path" 2>&1)"
  echo "$installer_signature_details"
  if [[ "$installer_signature_details" != *"Developer ID Installer:"* ]]; then
    echo "The package is not signed with Developer ID Installer." >&2
    exit 1
  fi
  installer_team_id="$(
    printf '%s\n' "$installer_signature_details" |
      awk '/Developer ID Installer:/ {
        line=$0
        sub(/^.*\(/, "", line)
        sub(/\).*$/, "", line)
        print line
        exit
      }'
  )"
  assert_distribution_team "The installer package" "$installer_team_id"
  installer_signature="developer_id_installer"
fi
resolved_team_id="$app_team_id"
if [[ -z "$resolved_team_id" || "$resolved_team_id" == "not set" ]]; then
  resolved_team_id="$installer_team_id"
fi

mkdir -p "$output_root"
mv -f "$unsigned_product_path" "$artifact_path"

notarized=false
stapled=false
gatekeeper_accepted=false
if [[ "$notary_credentials_available" == "1" ]]; then
  submit_for_notarization "$artifact_path"
  notarized=true
fi
if [[ "$notarized" == "true" ]]; then
  xcrun stapler staple "$artifact_path"
  xcrun stapler validate "$artifact_path"
  stapled=true
fi
if spctl --assess --type install --verbose=2 "$artifact_path"; then
  gatekeeper_accepted=true
elif [[ "$require_distribution" == "1" ]]; then
  echo "Gatekeeper rejected the installer package." >&2
  exit 1
fi

distribution_ready=false
if [[ "$app_signature" == "developer_id_application" \
  && "$installer_signature" == "developer_id_installer" \
  && "$app_notarized" == "true" \
  && "$app_stapled" == "true" \
  && "$notarized" == "true" \
  && "$stapled" == "true" \
  && "$gatekeeper_accepted" == "true" ]]; then
  distribution_ready=true
fi
if [[ "$require_distribution" == "1" && "$distribution_ready" != "true" ]]; then
  echo "The package did not satisfy every managed-distribution gate." >&2
  exit 1
fi

sha256="$(shasum -a 256 "$artifact_path" | awk '{print $1}')"
bytes="$(stat -f '%z' "$artifact_path")"
printf '%s  %s\n' "$sha256" "$artifact_name" > "$checksum_path"

ATRIUM_PACKAGE_MANIFEST="$manifest_path" \
ATRIUM_PACKAGE_ARTIFACT="$artifact_name" \
ATRIUM_PACKAGE_VERSION="$version" \
ATRIUM_PACKAGE_BUILD="$build_number" \
ATRIUM_PACKAGE_IDENTIFIER="$package_identifier" \
ATRIUM_BUNDLE_IDENTIFIER="$bundle_identifier" \
ATRIUM_PACKAGE_SHA256="$sha256" \
ATRIUM_PACKAGE_BYTES="$bytes" \
ATRIUM_TEAM_ID="$resolved_team_id" \
ATRIUM_APP_SIGNATURE="$app_signature" \
ATRIUM_INSTALLER_SIGNATURE="$installer_signature" \
ATRIUM_NOTARIZED="$notarized" \
ATRIUM_STAPLED="$stapled" \
ATRIUM_GATEKEEPER_ACCEPTED="$gatekeeper_accepted" \
ATRIUM_DISTRIBUTION_READY="$distribution_ready" \
node -e '
  const fs = require("node:fs");
  const env = process.env;
  const manifest = {
    schemaVersion: 1,
    artifact: env.ATRIUM_PACKAGE_ARTIFACT,
    version: env.ATRIUM_PACKAGE_VERSION,
    buildNumber: env.ATRIUM_PACKAGE_BUILD,
    packageIdentifier: env.ATRIUM_PACKAGE_IDENTIFIER,
    bundleIdentifier: env.ATRIUM_BUNDLE_IDENTIFIER,
    installLocation: "/",
    appPath: "/Applications/Atrium Capture.app",
    nativeMessagingManifest:
      "/Library/Google/Chrome/NativeMessagingHosts/org.psd401.atrium_capture.json",
    architectures: ["arm64", "x86_64"],
    sha256: env.ATRIUM_PACKAGE_SHA256,
    bytes: Number(env.ATRIUM_PACKAGE_BYTES),
    teamId: env.ATRIUM_TEAM_ID || null,
    appSignature: env.ATRIUM_APP_SIGNATURE,
    installerSignature: env.ATRIUM_INSTALLER_SIGNATURE,
    notarized: env.ATRIUM_NOTARIZED === "true",
    stapled: env.ATRIUM_STAPLED === "true",
    gatekeeperAccepted: env.ATRIUM_GATEKEEPER_ACCEPTED === "true",
    distributionReady: env.ATRIUM_DISTRIBUTION_READY === "true",
  };
  fs.writeFileSync(
    env.ATRIUM_PACKAGE_MANIFEST,
    `${JSON.stringify(manifest, null, 2)}\n`,
    { mode: 0o644 },
  );
'

node "$repository_root/scripts/verify-macos-package.mjs" "$manifest_path"
echo "$artifact_path"
