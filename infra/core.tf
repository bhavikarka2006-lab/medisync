resource "azurerm_resource_group" "main" {
  name     = "rg-${local.name}"
  location = var.location
}

# Managed Identity: lets the API and Functions reach Storage / Key Vault / ACR with no stored credentials
resource "azurerm_user_assigned_identity" "app" {
  name                = "id-${local.name}"
  resource_group_name = azurerm_resource_group.main.name
  location            = azurerm_resource_group.main.location
}

# ---- Key Vault: DB password, JWT signing key, admin password, ACS connection string ----
resource "azurerm_key_vault" "main" {
  name                       = "kv${local.flat}${local.suffix}"
  resource_group_name        = azurerm_resource_group.main.name
  location                   = azurerm_resource_group.main.location
  tenant_id                  = data.azurerm_client_config.current.tenant_id
  sku_name                   = "standard"
  soft_delete_retention_days = 7
  purge_protection_enabled   = false

  access_policy { # whoever runs Terraform (you in Cloud Shell, or the CI identity)
    tenant_id          = data.azurerm_client_config.current.tenant_id
    object_id          = data.azurerm_client_config.current.object_id
    secret_permissions = ["Get", "List", "Set", "Delete", "Purge", "Recover"]
  }
  access_policy { # the application identity: read-only (least privilege)
    tenant_id          = data.azurerm_client_config.current.tenant_id
    object_id          = azurerm_user_assigned_identity.app.principal_id
    secret_permissions = ["Get", "List"]
  }
}

resource "random_password" "db" {
  length  = 24
  special = false
}
resource "random_password" "jwt" {
  length  = 48
  special = false
}
resource "azurerm_key_vault_secret" "db" {
  name         = "db-password"
  value        = random_password.db.result
  key_vault_id = azurerm_key_vault.main.id
}
resource "azurerm_key_vault_secret" "jwt" {
  name         = "jwt-secret"
  value        = random_password.jwt.result
  key_vault_id = azurerm_key_vault.main.id
}
resource "azurerm_key_vault_secret" "admin" {
  name         = "admin-password"
  value        = var.admin_password
  key_vault_id = azurerm_key_vault.main.id
}
resource "azurerm_key_vault_secret" "acs" {
  name         = "acs-connection-string"
  value        = azurerm_communication_service.main.primary_connection_string
  key_vault_id = azurerm_key_vault.main.id
}

# ---- Container registry for the API image ----
resource "azurerm_container_registry" "main" {
  name                = "acr${local.flat}${local.suffix}"
  resource_group_name = azurerm_resource_group.main.name
  location            = azurerm_resource_group.main.location
  sku                 = "Basic"
  admin_enabled       = false
}
resource "azurerm_role_assignment" "acr_pull" {
  scope                            = azurerm_container_registry.main.id
  role_definition_name             = "AcrPull"
  principal_id                     = azurerm_user_assigned_identity.app.principal_id
  skip_service_principal_aad_check = true
}

# ---- Observability ----
resource "azurerm_log_analytics_workspace" "main" {
  name                = "log-${local.name}"
  resource_group_name = azurerm_resource_group.main.name
  location            = azurerm_resource_group.main.location
  sku                 = "PerGB2018"
  retention_in_days   = 30
}
resource "azurerm_application_insights" "main" {
  name                = "appi-${local.name}"
  resource_group_name = azurerm_resource_group.main.name
  location            = azurerm_resource_group.main.location
  workspace_id        = azurerm_log_analytics_workspace.main.id
  application_type    = "Node.JS"
}
