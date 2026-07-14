#!/usr/bin/env bash
# Infra deploy: Terraform only. Content deploys happen on `git push` (GitHub Pages from main).
# Only bootstrap secrets (provider auth) cross the boundary here.
set -euo pipefail
cd "$(dirname "$0")"

export GITHUB_TOKEN="$(gh auth token)"

terraform -chdir=infra init -input=false -upgrade=false >/dev/null
terraform -chdir=infra apply "$@"
