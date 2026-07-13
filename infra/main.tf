terraform {
  required_version = ">= 1.5"

  required_providers {
    github = {
      source  = "integrations/github"
      version = "~> 6.0"
    }
    render = {
      source  = "render-oss/render"
      version = "~> 1.0"
    }
  }
}

# Auth via GITHUB_TOKEN (bootstrap secret, loaded by deploy.sh).
provider "github" {}

# Auth via RENDER_API_KEY + RENDER_OWNER_ID (bootstrap secrets, loaded by deploy.sh).
provider "render" {}

resource "github_repository" "floatplan" {
  name        = "floatplan"
  description = "Pier 25 float plan — NY Harbor sailing conditions dashboard"
  visibility  = "private"

  has_issues   = false
  has_projects = false
  has_wiki     = false
}

resource "render_static_site" "floatplan" {
  name           = "floatplan"
  repo_url       = github_repository.floatplan.html_url
  branch         = "main"
  build_command  = ""
  publish_path   = "."
  auto_deploy    = true
}

output "site_url" {
  value = render_static_site.floatplan.url
}

output "repo_ssh_url" {
  value = github_repository.floatplan.ssh_clone_url
}
