resource "azurerm_log_analytics_workspace" "main" {
  name                = "log-${var.prefix}"
  resource_group_name = azurerm_resource_group.main.name
  location            = azurerm_resource_group.main.location
  sku                 = "PerGB2018"
  retention_in_days   = 30
  tags                = local.tags
}

resource "azurerm_container_app_environment" "main" {
  name                       = "cae-${var.prefix}"
  resource_group_name        = azurerm_resource_group.main.name
  location                   = azurerm_resource_group.main.location
  log_analytics_workspace_id = azurerm_log_analytics_workspace.main.id
  tags                       = local.tags
}

resource "random_password" "session_secret" {
  length  = 48
  special = false
}

resource "azurerm_container_app" "api" {
  name                         = "ca-${var.prefix}-api"
  resource_group_name          = azurerm_resource_group.main.name
  container_app_environment_id = azurerm_container_app_environment.main.id
  revision_mode                = "Single"
  tags                         = local.tags

  secret {
    name  = "database-url"
    value = local.database_url
  }
  secret {
    name  = "app-password"
    value = var.app_password
  }
  secret {
    name  = "session-secret"
    value = random_password.session_secret.result
  }

  ingress {
    external_enabled = true
    target_port      = 8000
    transport        = "auto"
    traffic_weight {
      latest_revision = true
      percentage      = 100
    }
  }

  template {
    min_replicas = 0 # scale to zero when idle: no cost, a few seconds of cold start
    max_replicas = 1

    container {
      name   = "api"
      image  = var.api_image
      cpu    = 0.25
      memory = "0.5Gi"

      env {
        name        = "DATABASE_URL"
        secret_name = "database-url"
      }
      env {
        name        = "APP_PASSWORD"
        secret_name = "app-password"
      }
      env {
        name        = "SESSION_SECRET"
        secret_name = "session-secret"
      }
      env {
        name  = "FRONTEND_URL"
        value = "https://${azurerm_static_web_app.main.default_host_name}"
      }
    }
  }

  lifecycle {
    # GitHub Actions deploys new image tags; Terraform must not revert them.
    ignore_changes = [template[0].container[0].image]
  }
}
