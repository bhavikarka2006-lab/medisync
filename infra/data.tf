# ---- Azure Database for PostgreSQL Flexible Server (managed DB; encrypted at rest, TLS enforced) ----
resource "azurerm_postgresql_flexible_server" "main" {
  name                          = "psql-${local.name}-${local.suffix}"
  resource_group_name           = azurerm_resource_group.main.name
  location                      = var.db_location != "" ? var.db_location : var.location
  version                       = "16"
  sku_name                      = "B_Standard_B1ms"
  storage_mb                    = 32768
  administrator_login           = "medisync_admin"
  administrator_password        = random_password.db.result
  backup_retention_days         = 7
  public_network_access_enabled = true

  lifecycle { ignore_changes = [zone] }
}
resource "azurerm_postgresql_flexible_server_database" "main" {
  name      = "medisync"
  server_id = azurerm_postgresql_flexible_server.main.id
  charset   = "UTF8"
  collation = "en_US.utf8"
}
# 0.0.0.0 rule = "allow Azure services" (Container App + Functions). Production would use private endpoints.
resource "azurerm_postgresql_flexible_server_firewall_rule" "azure" {
  name             = "AllowAzureServices"
  server_id        = azurerm_postgresql_flexible_server.main.id
  start_ip_address = "0.0.0.0"
  end_ip_address   = "0.0.0.0"
}

# ---- Storage account: private Blob container (records, invoices) + Queues (events) + Functions runtime ----
resource "azurerm_storage_account" "main" {
  name                            = "st${local.flat}${local.suffix}"
  resource_group_name             = azurerm_resource_group.main.name
  location                        = azurerm_resource_group.main.location
  account_tier                    = "Standard"
  account_replication_type        = "LRS"
  min_tls_version                 = "TLS1_2"
  https_traffic_only_enabled      = true
  allow_nested_items_to_be_public = false

  blob_properties {
    versioning_enabled = true
    delete_retention_policy { days = 7 }
    cors_rule {
      allowed_methods    = ["PUT", "GET", "OPTIONS"]
      allowed_origins    = ["*"]
      allowed_headers    = ["*"]
      exposed_headers    = ["*"]
      max_age_in_seconds = 300
    }
  }
}
resource "azurerm_storage_container" "docs" {
  name                  = "docs"
  storage_account_name  = azurerm_storage_account.main.name
  container_access_type = "private"
}
resource "azurerm_storage_queue" "appointment" {
  name                 = "appointment-events"
  storage_account_name = azurerm_storage_account.main.name
}
resource "azurerm_storage_queue" "invoice" {
  name                 = "invoice-events"
  storage_account_name = azurerm_storage_account.main.name
}
resource "azurerm_role_assignment" "blob" {
  scope                            = azurerm_storage_account.main.id
  role_definition_name             = "Storage Blob Data Contributor"
  principal_id                     = azurerm_user_assigned_identity.app.principal_id
  skip_service_principal_aad_check = true
}
resource "azurerm_role_assignment" "queue" {
  scope                            = azurerm_storage_account.main.id
  role_definition_name             = "Storage Queue Data Message Sender"
  principal_id                     = azurerm_user_assigned_identity.app.principal_id
  skip_service_principal_aad_check = true
}

# ---- Azure Communication Services: email notifications (replaces SNS) ----
resource "azurerm_email_communication_service" "main" {
  name                = "ecs-${local.name}-${local.suffix}"
  resource_group_name = azurerm_resource_group.main.name
  data_location       = "Asia Pacific"
}
resource "azurerm_email_communication_service_domain" "managed" {
  name              = "AzureManagedDomain"
  email_service_id  = azurerm_email_communication_service.main.id
  domain_management = "AzureManaged"
}
resource "azurerm_communication_service" "main" {
  name                = "acs-${local.name}-${local.suffix}"
  resource_group_name = azurerm_resource_group.main.name
  data_location       = "Asia Pacific"
}
resource "azurerm_communication_service_email_domain_association" "main" {
  communication_service_id = azurerm_communication_service.main.id
  email_service_domain_id  = azurerm_email_communication_service_domain.managed.id
}
