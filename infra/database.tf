resource "random_password" "sql_admin" {
  length      = 32
  special     = false # keeps the connection string free of characters that need escaping
  min_upper   = 1
  min_lower   = 1
  min_numeric = 1
}

resource "azurerm_mssql_server" "main" {
  name                         = "sql-${var.prefix}-${local.suffix}"
  resource_group_name          = azurerm_resource_group.main.name
  location                     = azurerm_resource_group.main.location
  version                      = "12.0"
  administrator_login          = "sqladmin"
  administrator_login_password = random_password.sql_admin.result
  minimum_tls_version          = "1.2"

  # You, as Entra admin, can use the portal Query editor without the SQL password.
  azuread_administrator {
    login_username              = var.entra_admin_login
    object_id                   = data.azurerm_client_config.current.object_id
    azuread_authentication_only = false
  }

  tags = local.tags
}

# azurerm has no setting for the free offer yet, so the database is created with azapi.
resource "azapi_resource" "database" {
  type      = "Microsoft.Sql/servers/databases@2025-01-01"
  name      = "sqldb-${var.prefix}"
  parent_id = azurerm_mssql_server.main.id
  location  = azurerm_resource_group.main.location
  tags      = local.tags

  body = {
    sku = {
      name     = "GP_S_Gen5"
      tier     = "GeneralPurpose"
      family   = "Gen5"
      capacity = 2
    }
    properties = {
      useFreeLimit = true
      # Never bills: pauses until next month instead. With AutoPause, Azure only allows the
      # default sleep delay (60 min idle), so autoPauseDelay must not be set.
      freeLimitExhaustionBehavior      = "AutoPause"
      minCapacity                      = 0.5
      maxSizeBytes                     = 34359738368 # 32 GB, the free-offer limit
      requestedBackupStorageRedundancy = "Local"
      zoneRedundant                    = false
    }
  }
}

# 0.0.0.0 is Azure's special rule for "allow Azure services", needed because
# Container Apps outbound IPs are not fixed on the consumption plan.
resource "azurerm_mssql_firewall_rule" "azure_services" {
  name             = "AllowAzureServices"
  server_id        = azurerm_mssql_server.main.id
  start_ip_address = "0.0.0.0"
  end_ip_address   = "0.0.0.0"
}

resource "azurerm_mssql_firewall_rule" "my_ip" {
  count            = var.my_ip == null ? 0 : 1
  name             = "MyIP"
  server_id        = azurerm_mssql_server.main.id
  start_ip_address = var.my_ip
  end_ip_address   = var.my_ip
}

locals {
  database_url = join("", [
    "mssql+pyodbc://sqladmin:${random_password.sql_admin.result}",
    "@${azurerm_mssql_server.main.fully_qualified_domain_name}:1433/${azapi_resource.database.name}",
    "?driver=ODBC+Driver+18+for+SQL+Server&Encrypt=yes&TrustServerCertificate=no&Connection+Timeout=60",
  ])
}
