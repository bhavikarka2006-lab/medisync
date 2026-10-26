output "app_url" { value = var.deploy_app ? "https://${azurerm_container_app.api[0].ingress[0].fqdn}" : "(deploy_app=false)" }
output "resource_group" { value = azurerm_resource_group.main.name }
output "acr_name" { value = azurerm_container_registry.main.name }
output "acr_login_server" { value = azurerm_container_registry.main.login_server }
output "function_app_name" { value = azurerm_linux_function_app.main.name }
output "key_vault_name" { value = azurerm_key_vault.main.name }
output "postgres_host" { value = azurerm_postgresql_flexible_server.main.fqdn }
output "storage_account" { value = azurerm_storage_account.main.name }
output "admin_email" { value = var.admin_email }
