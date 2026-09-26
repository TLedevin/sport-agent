variable "subscription_id" {
  type        = string
  description = "Azure subscription ID (az account show --query id -o tsv)."
}

variable "location" {
  type        = string
  default     = "westeurope"
  description = "Azure region. Must support Static Web Apps (e.g. westeurope)."
}

variable "prefix" {
  type        = string
  default     = "sportagent"
  description = "Short name used in every resource name."
}

variable "github_owner" {
  type        = string
  description = "GitHub user or organisation owning the repo, with its exact case."
}

variable "github_repo" {
  type        = string
  description = "GitHub repository name."
}

# GitHub's OIDC subject includes numeric IDs ("repo:Owner@123/repo@456:...").
# They are shown in the "subject claim" line of a failed azure/login step.
variable "github_owner_id" {
  type        = string
  default     = null
  description = "Numeric GitHub owner ID, if GitHub sends it in the OIDC subject."
}

variable "github_repo_id" {
  type        = string
  default     = null
  description = "Numeric GitHub repository ID, if GitHub sends it in the OIDC subject."
}

variable "entra_admin_login" {
  type        = string
  description = "Label for you as the SQL server's Entra admin, e.g. your sign-in email."
}

variable "my_ip" {
  type        = string
  default     = null
  description = "Optional public IP allowed through the SQL firewall, for local tools."
}

variable "app_password" {
  type        = string
  sensitive   = true
  description = "Password you type to log into the web app."
}

variable "api_image" {
  type        = string
  default     = "mcr.microsoft.com/k8se/quickstart:latest"
  description = "Initial image only. After creation, GitHub Actions deploys the real image."
}
