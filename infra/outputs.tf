output "api_url" {
  value = "https://${azurerm_container_app.api.ingress[0].fqdn}"
}

output "frontend_url" {
  value = "https://${azurerm_static_web_app.main.default_host_name}"
}

output "resource_group" {
  value = azurerm_resource_group.main.name
}

output "container_app_name" {
  value = azurerm_container_app.api.name
}

output "sql_server" {
  value = azurerm_mssql_server.main.fully_qualified_domain_name
}

# GitHub repo settings -> Secrets and variables -> Actions
output "github_variables" {
  value = {
    AZURE_CLIENT_ID       = azuread_application.github.client_id
    AZURE_TENANT_ID       = data.azurerm_client_config.current.tenant_id
    AZURE_SUBSCRIPTION_ID = var.subscription_id
    AZURE_RESOURCE_GROUP  = azurerm_resource_group.main.name
    AZURE_CONTAINER_APP   = azurerm_container_app.api.name
    VITE_API_URL          = "https://${azurerm_container_app.api.ingress[0].fqdn}"
  }
}

# terraform output -raw swa_deployment_token  -> GitHub secret AZURE_STATIC_WEB_APPS_API_TOKEN
output "swa_deployment_token" {
  value     = azurerm_static_web_app.main.api_key
  sensitive = true
}
