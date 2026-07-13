#!/usr/bin/env bash
# Infra deploy: Terraform only. Content deploys happen on `git push` (auto_deploy).
# Only bootstrap secrets (provider auth) cross the boundary here.
set -euo pipefail
cd "$(dirname "$0")"

export GITHUB_TOKEN="$(gh auth token)"
export RENDER_API_KEY="$(security find-generic-password -s render-api-key -w)"
export RENDER_OWNER_ID="tea-d639f5mr433s738b9pi0"

terraform -chdir=infra init -input=false -upgrade=false >/dev/null
terraform -chdir=infra apply "$@"
