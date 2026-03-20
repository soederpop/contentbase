#!/usr/bin/env bash
set -euo pipefail

# Release contentbase: compile all platforms, tag, and upload binaries to GitHub
# Usage: ./scripts/release.sh [--dry-run]

DRY_RUN=false
[[ "${1:-}" == "--dry-run" ]] && DRY_RUN=true

cd "$(dirname "$0")/.."

VERSION=$(grep '"version"' package.json | head -1 | sed 's/.*"\([0-9][^"]*\)".*/\1/')
TAG="v${VERSION}"

echo "==> Releasing contentbase ${TAG}"

# Bail if tag already exists
if git rev-parse "$TAG" >/dev/null 2>&1; then
  echo "Error: tag ${TAG} already exists. Bump the version in package.json first."
  exit 1
fi

# Compile binaries for all platforms
echo "==> Compiling binaries..."
bun run compile:all

# Verify binaries were built
BINARIES=(
  dist/cnotes-linux-x64
  dist/cnotes-linux-arm64
  dist/cnotes-darwin-x64
  dist/cnotes-darwin-arm64
  dist/cnotes-windows-x64.exe
)

for bin in "${BINARIES[@]}"; do
  if [[ ! -f "$bin" ]]; then
    echo "Error: expected binary ${bin} not found"
    exit 1
  fi
done

echo "==> Built binaries:"
ls -lh dist/cnotes-*

if $DRY_RUN; then
  echo "==> Dry run — skipping tag and release creation"
  exit 0
fi

# Tag and push
echo "==> Tagging ${TAG}..."
git tag -a "$TAG" -m "Release ${TAG}"
git push origin "$TAG"

# Create GitHub release with binaries
echo "==> Creating GitHub release..."
gh release create "$TAG" \
  --title "contentbase ${TAG}" \
  --generate-notes \
  "${BINARIES[@]}"

echo "==> Done! https://github.com/soederpop/contentbase/releases/tag/${TAG}"
