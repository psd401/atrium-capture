#!/bin/zsh
set -euo pipefail

repository_root="${0:A:h:h}"
export CLANG_MODULE_CACHE_PATH="${CLANG_MODULE_CACHE_PATH:-/private/tmp/atrium-capture-clang-cache}"
export SWIFTPM_MODULECACHE_OVERRIDE="${SWIFTPM_MODULECACHE_OVERRIDE:-/private/tmp/atrium-capture-swift-cache}"

if [[ "$(uname -s)" == "Darwin" && "$(xcode-select -p)" == *"Xcode.app"* ]]; then
  swift test --disable-sandbox --package-path "$repository_root/apps/macos"
elif [[ "$(uname -s)" != "Darwin" ]]; then
  swift test --package-path "$repository_root/apps/macos"
elif command -v docker >/dev/null 2>&1; then
  docker run --rm \
    -v "$repository_root:/workspace" \
    -w /workspace \
    swift:6.0-bookworm \
    swift test --scratch-path /tmp/atrium-capture-swift-build --package-path apps/macos
else
  echo "A matching full Xcode installation or Docker is required for Swift XCTest." >&2
  exit 1
fi
