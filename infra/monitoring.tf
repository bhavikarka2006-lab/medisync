resource "azurerm_monitor_action_group" "ops" {
  name                = "ag-${local.name}"
  resource_group_name = azurerm_resource_group.main.name
  short_name          = "medisync"
  email_receiver {
    name          = "ops"
    email_address = var.alert_email
  }
}

# 5xx errors from the API
resource "azurerm_monitor_metric_alert" "api_5xx" {
  count               = var.deploy_app ? 1 : 0
  name                = "${local.name}-api-5xx"
  resource_group_name = azurerm_resource_group.main.name
  scopes              = [azurerm_container_app.api[0].id]
  severity            = 2
  frequency           = "PT5M"
  window_size         = "PT5M"
  criteria {
    metric_namespace = "microsoft.app/containerapps"
    metric_name      = "Requests"
    aggregation      = "Total"
    operator         = "GreaterThan"
    threshold        = 5
    dimension {
      name     = "statusCodeCategory"
      operator = "Include"
      values   = ["5xx"]
    }
  }
  action { action_group_id = azurerm_monitor_action_group.ops.id }
}

# Database CPU
resource "azurerm_monitor_metric_alert" "db_cpu" {
  name                = "${local.name}-db-cpu"
  resource_group_name = azurerm_resource_group.main.name
  scopes              = [azurerm_postgresql_flexible_server.main.id]
  severity            = 3
  frequency           = "PT5M"
  window_size         = "PT15M"
  criteria {
    metric_namespace = "Microsoft.DBforPostgreSQL/flexibleServers"
    metric_name      = "cpu_percent"
    aggregation      = "Average"
    operator         = "GreaterThan"
    threshold        = 80
  }
  action { action_group_id = azurerm_monitor_action_group.ops.id }
}
