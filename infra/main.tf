terraform {
  required_version = ">= 1.6"
  required_providers {
    azurerm = { source = "hashicorp/azurerm", version = "~> 4.10" }
    random  = { source = "hashicorp/random", version = "~> 3.6" }
    time    = { source = "hashicorp/time", version = "~> 0.12" }
  }
  # Remote state in Azure Blob Storage (created by scripts/bootstrap.sh); shared by Cloud Shell and CI
  backend "azurerm" {}
}

provider "azurerm" {
  subscription_id                 = var.subscription_id
  resource_provider_registrations = "none"
  resource_providers_to_register = [
    "Microsoft.App", "Microsoft.OperationalInsights", "Microsoft.Insights", "Microsoft.Communication",
    "Microsoft.DBforPostgreSQL", "Microsoft.ContainerRegistry", "Microsoft.KeyVault", "Microsoft.Web",
    "Microsoft.ManagedIdentity", "Microsoft.Storage", "Microsoft.Authorization"
  ]
  features {
    key_vault { purge_soft_delete_on_destroy = true }
    resource_group { prevent_deletion_if_contains_resources = false }
  }
}

data "azurerm_client_config" "current" {}

resource "random_string" "suffix" {
  length  = 5
  upper   = false
  special = false
}

locals {
  name   = "${var.project}-${var.env}"
  flat   = replace(local.name, "-", "")
  suffix = random_string.suffix.result
}
