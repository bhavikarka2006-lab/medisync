#!/usr/bin/env bash
# One-time setup. Run in Azure Cloud Shell (Bash):  ./scripts/bootstrap.sh <github-user>/<repo>
# Creates (1) a storage account for Terraform state and (2) a managed identity that GitHub Actions can log in as
# (OIDC federation: no passwords/secrets stored in GitHub). Managed identities need no Entra app-registration rights.
set -euo pipefail
REPO=${1:?usage: bootstrap.sh <github-user>/<repo>}
LOCATION=${LOCATION:-centralindia}
SUB=$(az account show --query id -o tsv)
TENANT=$(az account show --query tenantId -o tsv)
RG=rg-medisync-tfstate
SA="medisynctf$(echo "$SUB" | tr -d '-' | cut -c1-10)"
IDN=id-medisync-github

echo "Subscription: $SUB"
for rp in Microsoft.Storage Microsoft.ManagedIdentity Microsoft.Authorization; do az provider register --namespace $rp >/dev/null; done

az group create -n $RG -l "$LOCATION" -o none
az storage account create -n "$SA" -g $RG -l "$LOCATION" --sku Standard_LRS --min-tls-version TLS1_2 --allow-blob-public-access false -o none
az storage container create --account-name "$SA" -n tfstate -o none

az identity create -g $RG -n $IDN -l "$LOCATION" -o none
CLIENT_ID=$(az identity show -g $RG -n $IDN --query clientId -o tsv)
PRINCIPAL=$(az identity show -g $RG -n $IDN --query principalId -o tsv)
az identity federated-credential create -g $RG --identity-name $IDN --name github-main \
  --issuer https://token.actions.githubusercontent.com --subject "repo:$REPO:ref:refs/heads/main" \
  --audiences api://AzureADTokenExchange -o none
sleep 20   # let the new identity replicate before assigning a role
az role assignment create --assignee-object-id "$PRINCIPAL" --assignee-principal-type ServicePrincipal \
  --role Owner --scope "/subscriptions/$SUB" -o none

cat <<OUT

=============== DONE. Add these as GitHub repo secrets ===============
AZURE_CLIENT_ID        = $CLIENT_ID
AZURE_TENANT_ID        = $TENANT
AZURE_SUBSCRIPTION_ID  = $SUB
TF_STATE_RG            = $RG
TF_STATE_SA            = $SA
ALERT_EMAIL            = <your email>
ADMIN_PASSWORD         = <choose a strong admin password, 8+ chars>
(optional) NOTIFY_EMAILS_JSON = ["friend@example.com"]
======================================================================
Terraform backend flags (for manual runs):
  terraform init -backend-config="resource_group_name=$RG" -backend-config="storage_account_name=$SA" \\
    -backend-config="container_name=tfstate" -backend-config="key=medisync.tfstate"
OUT
