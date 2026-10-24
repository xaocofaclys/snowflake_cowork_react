#!/usr/bin/env bash
# Builds the three CoWork images for linux/amd64 (what SPCS runs) and pushes them to the
# Snowflake image repository created in snowflake/05_spcs.sql (PART 1).
#
# Usage (from anywhere):   ./deploy/spcs/build_push.sh
#   TAG=v2 ./deploy/spcs/build_push.sh        # new version
#   SKIP_LOGIN=1 ./deploy/spcs/build_push.sh  # you already ran `docker login` yourself
#
# Registry login uses the Snowflake CLI with the COWORK_SVC key pair, so no password/MFA prompt.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"

ACCOUNT="${SNOWFLAKE_ACCOUNT:-LBXPLBY-JJ73300}"
REGISTRY="${REGISTRY:-$(echo "$ACCOUNT" | tr '[:upper:]' '[:lower:]' | tr '_' '-').registry.snowflakecomputing.com}"
REPO_PATH="${REPO_PATH:-cowork_app/spcs/images}"
TAG="${TAG:-v1}"
PLATFORM="linux/amd64"

command -v docker >/dev/null || { echo "docker not found: install Docker Desktop first"; exit 1; }
docker info >/dev/null 2>&1 || { echo "Docker is installed but not running: start Docker Desktop"; exit 1; }

if [[ -z "${SKIP_LOGIN:-}" ]]; then
  command -v snow >/dev/null || { echo "Snowflake CLI not found: brew install snowflake-cli (or SKIP_LOGIN=1 after docker login)"; exit 1; }
  echo "→ Logging in to $REGISTRY as COWORK_SVC"
  snow spcs image-registry login -x \
    --account "$ACCOUNT" \
    --user COWORK_SVC \
    --authenticator SNOWFLAKE_JWT \
    --private-key-file "$ROOT/cowork_svc.p8" \
    --role COWORK_APP_SERVICE \
    --warehouse COWORK_WH
fi

build_push() {
  local name="$1" dockerfile="$2" context="$3"
  local image="$REGISTRY/$REPO_PATH/$name:$TAG"
  echo "→ Building and pushing $image"
  docker buildx build --platform "$PLATFORM" -f "$dockerfile" -t "$image" --push "$context"
}

build_push cowork-api docker/api.Dockerfile .
build_push cowork-web docker/web.Dockerfile .
build_push cowork-router docker/router/Dockerfile docker/router

echo
echo "✓ Pushed $REPO_PATH/{cowork-api,cowork-web,cowork-router}:$TAG"
echo "  Next: run PART 2 of snowflake/05_spcs.sql (use :$TAG in the spec)."
