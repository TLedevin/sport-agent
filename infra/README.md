# Infrastructure (Terraform)

Creates everything the app runs on, in one resource group `rg-sportagent`:

| Resource | Purpose | Cost |
|---|---|---|
| Static Web App (Free) | Hosts the React frontend | free |
| Container App (0–1 replica) + environment | Runs the FastAPI backend | free grant covers personal use |
| Azure SQL serverless, **free offer** | Database, auto-pauses when idle | free (pauses instead of billing if limits are hit) |
| Log Analytics | Backend logs | free under 5 GB/month |
| Entra app + OIDC credential | Lets GitHub Actions deploy without a stored password | free |

The Terraform state lives in a storage account in `rg-sportagent-tfstate` (a few cents/month).

## Prerequisites

```powershell
winget install Microsoft.AzureCLI
winget install Hashicorp.Terraform
az login
az account show --query id -o tsv   # your subscription ID
```

## 1. One-time: state storage

```powershell
cd infra/bootstrap
terraform init
terraform apply -var="subscription_id=<your-subscription-id>"
terraform output -raw backend_config > ../backend.hcl
```

Keep `bootstrap/terraform.tfstate`. It is small and git-ignored.

## 2. Main infrastructure

```powershell
cd infra
copy terraform.tfvars.example terraform.tfvars   # then edit it
terraform init "-backend-config=backend.hcl"   # quotes needed in PowerShell
terraform plan
terraform apply
```

Until the backend is deployed by GitHub Actions, the Container App runs a placeholder image and its URL won't answer (the app expects port 8000).

## 3. Connect GitHub Actions

In the GitHub repo, open **Settings → Secrets and variables → Actions**:

- **Variables**: every entry of `terraform output github_variables`
- **Secret** `AZURE_STATIC_WEB_APPS_API_TOKEN` = `terraform output -raw swa_deployment_token`

After the first backend build, open **Your profile → Packages → sport-agent-api → Package settings** and set the visibility to **Public**, so Azure can pull the image without credentials.

## Everyday use

- Changing infrastructure: edit the `.tf` files, then run `terraform plan` and `terraform apply`.
- Changing app code: push to `main`, and GitHub Actions deploys it. Terraform ignores the image tag on purpose.
- Deleting everything: `terraform destroy` (the state storage in `bootstrap/` is separate).
