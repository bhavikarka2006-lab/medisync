# How to present this to ma'am (about 10 minutes)

**One-line story:** "We built a hospital system, but the real project is *how* it runs: managed Azure services, everything defined as code, and a pipeline that deploys on every push."

## Order
1. Problem and why cloud (bursty load, sensitive data, no ops team)
2. Architecture diagram (README) and walk through the booking flow
3. **Topics table** (README): this is the slide she cares about
4. DevOps pipeline: commit → tests → image → Terraform → Functions → smoke test
5. Security: Key Vault, managed identity, RBAC, audit log
6. Live demo (below), then limitations and future work

## Live demo (each step proves a topic)
| Do this | Proves |
|---|---|
| GitHub → Actions: show a green run; change a text, push, watch it redeploy | CI/CD, IaC |
| Azure portal → resource group `rg-medisync-dev`: show all resources | Cloud services, Terraform-managed |
| Log in as patient → book a slot → status flips *pending → confirmed* and an email arrives | Queue + Function + email (event-driven) |
| Book the same slot again as another patient: it is crossed out / 409 | Concurrency control in PostgreSQL |
| Log in as nurse: assign a bed; as doctor: discharge → invoice PDF appears in Billing | Serverless PDF generation + Blob Storage |
| Patient tries Patients page: not visible; admin → **Audit log** shows `access_denied` | RBAC + audit trail |
| Azure → Key Vault → Secrets (names only) and the Container App's identity | Secrets management, managed identity |
| Container App → Scale / Revision, Log stream | Autoscaling, containers |
| Log Analytics → run the query below | Monitoring |
| Cost Management page (student credit) | FinOps |
| Run *destroy-environment* | Reproducibility, zero idle cost |

## Log Analytics query (Container App logs → audit events)
```
ContainerAppConsoleLogs_CL
| where Log_s has '"type":"audit"'
| project TimeGenerated, Log_s
| order by TimeGenerated desc
```
Access-denied only: add `| where Log_s has "access_denied"`.

## Likely viva questions
- *Why Container Apps and not a VM?* Managed, autoscaling, no OS patching, per-use billing.
- *Why queues + Functions?* Decouples slow work (email, PDF) from the request, absorbs bursts, pay per execution.
- *Why Terraform?* Repeatable, reviewable, destroyable, no console clicking.
- *Why managed identity + Key Vault?* No passwords in code or config; access is revocable and audited.
- *Why not Entra ID login?* College tenant blocks app registrations for students; we explain the trade-off honestly.
- *How do you prevent double booking?* Unique partial index in PostgreSQL, so even simultaneous requests cannot both win.
