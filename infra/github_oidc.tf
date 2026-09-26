# Lets GitHub Actions log into Azure with OIDC (no stored Azure password),
# restricted to pushes on main and to updating the Container App.

resource "azuread_application" "github" {
  display_name = "github-${var.prefix}-deploy"
}

resource "azuread_service_principal" "github" {
  client_id = azuread_application.github.client_id
}

resource "azuread_application_federated_identity_credential" "main_branch" {
  application_id = azuread_application.github.id
  display_name   = "github-main"
  audiences      = ["api://AzureADTokenExchange"]
  issuer         = "https://token.actions.githubusercontent.com"
  subject        = "repo:${local.github_repo_claim}:ref:refs/heads/main"
}

locals {
  github_repo_claim = (
    var.github_owner_id != null && var.github_repo_id != null
    ? "${var.github_owner}@${var.github_owner_id}/${var.github_repo}@${var.github_repo_id}"
    : "${var.github_owner}/${var.github_repo}"
  )
}

resource "azurerm_role_assignment" "github_containerapp" {
  scope                = azurerm_container_app.api.id
  role_definition_name = "Contributor"
  principal_id         = azuread_service_principal.github.object_id
}

# `az containerapp update` also reads the environment and resource group.
resource "azurerm_role_assignment" "github_rg_reader" {
  scope                = azurerm_resource_group.main.id
  role_definition_name = "Reader"
  principal_id         = azuread_service_principal.github.object_id
}
