variable "subscription_id" {
  description = "Azure subscription ID (Azure for Students)"
  type        = string
}
variable "location" {
  description = "Azure region. Students have an allowed-regions policy: if apply says a region is not allowed, pick one from the error."
  type        = string
  default     = "centralindia"
}
variable "db_location" {
  description = "Region for PostgreSQL (often restricted separately on student subscriptions)"
  type        = string
  default     = ""
}
variable "project" {
  type    = string
  default = "medisync"
}
variable "env" {
  type    = string
  default = "dev"
}
variable "alert_email" {
  description = "Receives Azure Monitor alerts and notification copies"
  type        = string
}
variable "notification_emails" {
  description = "Extra staff emails that receive a copy of every notification"
  type        = list(string)
  default     = []
}
variable "admin_password" {
  description = "Password for the admin account (stored in Key Vault)"
  type        = string
  sensitive   = true
}
variable "admin_email" {
  type    = string
  default = "admin@medisync.local"
}
variable "seed_demo" {
  description = "Create demo doctors/nurse/patients/beds (known demo passwords: set false for real use)"
  type        = bool
  default     = true
}
variable "deploy_app" {
  description = "Create the Container App. Pipeline/README run a registry-only apply first, then push the image, then apply with true"
  type        = bool
  default     = true
}
variable "image_tag" {
  type    = string
  default = "latest"
}
variable "min_replicas" {
  type    = number
  default = 1
}
variable "function_sku" {
  description = "Y1 = Consumption (pay per execution). If your subscription has 0 quota for it, try B1."
  type        = string
  default     = "Y1"
}
