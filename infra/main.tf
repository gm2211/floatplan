terraform {
  required_version = ">= 1.5"

  required_providers {
    github = {
      source  = "integrations/github"
      version = "~> 6.0"
    }
  }
}

# Auth via GITHUB_TOKEN (bootstrap secret, loaded by deploy.sh).
provider "github" {}

resource "github_repository" "floatplan" {
  name        = "floatplan"
  description = "Pier 25 float plan — NY Harbor sailing conditions dashboard"
  visibility  = "public"

  has_issues   = false
  has_projects = false
  has_wiki     = false
}

resource "github_repository_pages" "floatplan" {
  repository = github_repository.floatplan.name

  build_type = "legacy"
  source {
    branch = "main"
    path   = "/"
  }
}

output "pages_url" {
  value = github_repository_pages.floatplan.html_url
}

output "repo_ssh_url" {
  value = github_repository.floatplan.ssh_clone_url
}
