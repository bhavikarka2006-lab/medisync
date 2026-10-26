# Role assignments can take a minute to propagate; wait before the app tries to pull images / read secrets
resource "time_sleep" "rbac" {
  depends_on      = [azurerm_role_assignment.acr_pull, azurerm_role_assignment.blob, azurerm_role_assignment.queue]
  create_duration = "60s"
}

# ---- Azure Container Apps: serverless containers for the API (autoscaling on HTTP load) ----
resource "azurerm_container_app_environment" "main" {
  name                       = "cae-${local.name}"
  resource_group_name        = azurerm_resource_group.main.name
  location                   = azurerm_resource_group.main.location
  log_analytics_workspace_id = azurerm_log_analytics_workspace.main.id
}

resource "azurerm_container_app" "api" {
  count                        = var.deploy_app ? 1 : 0
  name                         = "ca-${local.name}-api"
  resource_group_name          = azurerm_resource_group.main.name
  container_app_environment_id = azurerm_container_app_environment.main.id
  revision_mode                = "Single"

  identity {
    type         = "UserAssigned"
    identity_ids = [azurerm_user_assigned_identity.app.id]
  }
  registry {
    server   = azurerm_container_registry.main.login_server
    identity = azurerm_user_assigned_identity.app.id
  }
  # Secrets are pulled from Key Vault by the managed identity (never stored in Terraform vars or the image)
  secret {
    name                = "db-password"
    identity            = azurerm_user_assigned_identity.app.id
    key_vault_secret_id = azurerm_key_vault_secret.db.versionless_id
  }
  secret {
    name                = "jwt-secret"
    identity            = azurerm_user_assigned_identity.app.id
    key_vault_secret_id = azurerm_key_vault_secret.jwt.versionless_id
  }
  secret {
    name                = "admin-password"
    identity            = azurerm_user_assigned_identity.app.id
    key_vault_secret_id = azurerm_key_vault_secret.admin.versionless_id
  }

  ingress {
    external_enabled = true
    target_port      = 3000
    traffic_weight {
      percentage      = 100
      latest_revision = true
    }
  }

  template {
    min_replicas = var.min_replicas
    max_replicas = 3
    http_scale_rule {
      name                = "http-load"
      concurrent_requests = "50"
    }
    container {
      name   = "api"
      image  = "${azurerm_container_registry.main.login_server}/medisync-api:${var.image_tag}"
      cpu    = 0.25
      memory = "0.5Gi"

      env {
        name  = "PORT"
        value = "3000"
      }
      env {
        name  = "DB_HOST"
        value = azurerm_postgresql_flexible_server.main.fqdn
      }
      env {
        name  = "DB_NAME"
        value = azurerm_postgresql_flexible_server_database.main.name
      }
      env {
        name  = "DB_USER"
        value = "medisync_admin"
      }
      env {
        name  = "DB_SSL"
        value = "true"
      }
      env {
        name        = "DB_PASSWORD"
        secret_name = "db-password"
      }
      env {
        name        = "JWT_SECRET"
        secret_name = "jwt-secret"
      }
      env {
        name  = "ADMIN_EMAIL"
        value = var.admin_email
      }
      env {
        name        = "ADMIN_PASSWORD"
        secret_name = "admin-password"
      }
      env {
        name  = "SEED_DEMO"
        value = tostring(var.seed_demo)
      }
      env {
        name  = "STORAGE_ACCOUNT"
        value = azurerm_storage_account.main.name
      }
      env {
        name  = "DOCS_CONTAINER"
        value = azurerm_storage_container.docs.name
      }
      env {
        name  = "AZURE_CLIENT_ID"
        value = azurerm_user_assigned_identity.app.client_id
      }
      liveness_probe {
        transport = "HTTP"
        port      = 3000
        path      = "/health"
      }
    }
  }
  depends_on = [time_sleep.rbac, azurerm_postgresql_flexible_server_firewall_rule.azure]
}

# ---- Azure Functions (serverless): queue-triggered + timer-triggered; code is deployed by the CI/CD pipeline ----
resource "azurerm_service_plan" "func" {
  name                = "asp-${local.name}"
  resource_group_name = azurerm_resource_group.main.name
  location            = azurerm_resource_group.main.location
  os_type             = "Linux"
  sku_name            = var.function_sku
}

resource "azurerm_linux_function_app" "main" {
  name                       = "func-${local.name}-${local.suffix}"
  resource_group_name        = azurerm_resource_group.main.name
  location                   = azurerm_resource_group.main.location
  service_plan_id            = azurerm_service_plan.func.id
  storage_account_name       = azurerm_storage_account.main.name
  storage_account_access_key = azurerm_storage_account.main.primary_access_key
  https_only                 = true

  identity {
    type         = "UserAssigned"
    identity_ids = [azurerm_user_assigned_identity.app.id]
  }
  key_vault_reference_identity_id = azurerm_user_assigned_identity.app.id

  site_config {
    application_insights_connection_string = azurerm_application_insights.main.connection_string
    application_stack { node_version = "20" }
  }

  app_settings = {
    DB_HOST               = azurerm_postgresql_flexible_server.main.fqdn
    DB_NAME               = azurerm_postgresql_flexible_server_database.main.name
    DB_USER               = "medisync_admin"
    DB_PASSWORD           = "@Microsoft.KeyVault(SecretUri=${azurerm_key_vault_secret.db.versionless_id})"
    ACS_CONNECTION_STRING = "@Microsoft.KeyVault(SecretUri=${azurerm_key_vault_secret.acs.versionless_id})"
    SENDER_ADDRESS        = "DoNotReply@${azurerm_email_communication_service_domain.managed.mail_from_sender_domain}"
    NOTIFY_EMAILS         = join(",", concat([var.alert_email], var.notification_emails))
    DOCS_CONTAINER        = azurerm_storage_container.docs.name
  }
  depends_on = [time_sleep.rbac, azurerm_communication_service_email_domain_association.main]
}
