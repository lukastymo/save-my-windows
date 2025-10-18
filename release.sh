#!/usr/bin/env bash
# Release script for Save My Windows GNOME extension
# Creates a git tag with version from metadata.json

set -euo pipefail

# Get the script directory
ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" >/dev/null 2>&1 && pwd)"
cd "$ROOT"

# Check if we're in a git repository
if ! git rev-parse --git-dir >/dev/null 2>&1; then
    echo "Error: Not in a git repository" >&2
    exit 1
fi

# Check if there are uncommitted changes
if ! git diff-index --quiet HEAD --; then
    echo "Error: There are uncommitted changes. Please commit or stash them first." >&2
    git status --short
    exit 1
fi

# Extract version from metadata.json
if [[ ! -f "metadata.json" ]]; then
    echo "Error: metadata.json not found" >&2
    exit 1
fi

VERSION=$(jq -r '.version' metadata.json)
if [[ "$VERSION" == "null" || -z "$VERSION" ]]; then
    echo "Error: Could not extract version from metadata.json" >&2
    exit 1
fi

TAG_NAME="v${VERSION}"

# Check if tag already exists
if git tag -l | grep -q "^${TAG_NAME}$"; then
    echo "Error: Tag ${TAG_NAME} already exists" >&2
    echo "Existing tags:" >&2
    git tag -l | grep "^v" | sort -V >&2
    exit 1
fi

# Create and push the tag
echo "Creating tag ${TAG_NAME} for version ${VERSION}..."
git tag -a "${TAG_NAME}" -m "Release version ${VERSION}"

echo "Tag ${TAG_NAME} created successfully!"
echo ""
echo "To push the tag to remote:"
echo "  git push origin ${TAG_NAME}"
echo ""
echo "To push all tags:"
echo "  git push origin --tags"
echo ""
echo "To create a GitHub release, visit:"
echo "  https://github.com/lukastymo/save-my-windows/releases/new?tag=${TAG_NAME}"
