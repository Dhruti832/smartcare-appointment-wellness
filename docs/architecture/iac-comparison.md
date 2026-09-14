# Infrastructure as Code (IaC) Options — SAWS

## Overview

SAWS is a multi-cloud serverless application deployed across AWS and GCP. Managing cloud
resources manually is error-prone and not repeatable, especially across two cloud providers.
Infrastructure as Code (IaC) solves this by defining all cloud resources (databases, queues,
functions, containers) in version-controlled configuration files that can be reviewed, tested,
and deployed automatically through the CI/CD pipeline.

This document compares the three IaC tools considered for SAWS and explains which is used
for which layer.

---

## Side-by-Side Comparison

| Feature | CloudFormation | Terraform | Deployment Manager |
|---------|---------------|-----------|-------------------|
| Cloud support | AWS only | AWS + GCP + others | GCP only |
| Language | YAML / JSON | HCL | YAML + Jinja2 |
| State management | Managed by AWS | Remote backend (S3/GCS) | Managed by GCP |
| Drift detection | Yes | Yes (`terraform plan`) | Limited |
| CI/CD integration | AWS CodePipeline / GitLab | Any CI tool | GCP Cloud Build / GitLab |
| Community support | Large | Very large | Small |
| Cost | Free | Free (open source) | Free |
| Learning curve | Medium | Medium | Medium |

---

---

## Option 1: AWS CloudFormation

**What it is**: AWS-native declarative IaC using YAML/JSON templates.

**Used for**: AWS-only resources in SAWS.

| Resource | CloudFormation Type |
|----------|-------------------|
| Cognito User Pool | `AWS::Cognito::UserPool` |
| DynamoDB Tables | `AWS::DynamoDB::Table` |
| SQS Queue | `AWS::SQS::Queue` |
| SNS Topic | `AWS::SNS::Topic` |
| Lambda Functions | `AWS::Lambda::Function` |
| IAM Roles | `AWS::IAM::Role` |

**Pros**:
- Native AWS support, no extra tooling needed
- Deep integration with all AWS services
- Free to use (no licensing)
- Drift detection built in

**Cons**:
- AWS-only — cannot manage GCP resources
- YAML can become verbose for large stacks
- Rollback behaviour can be unpredictable on partial failures

---

## Option 2: Terraform (HashiCorp)

**What it is**: Cloud-agnostic, declarative IaC using HCL (HashiCorp Configuration Language).

**Used for**: Both AWS and GCP resources in SAWS — the cross-cloud bridge.

| Resource | Terraform Provider |
|----------|-------------------|
| All AWS resources | `hashicorp/aws` |
| Firestore | `hashicorp/google` |
| Cloud Run | `hashicorp/google` |
| Pub/Sub | `hashicorp/google` |
| Cloud Functions | `hashicorp/google` |

**Pros**:
- Single tool manages both AWS and GCP
- State management with remote backends (S3 / GCS)
- Large community, well-documented modules
- Plan preview (`terraform plan`) before applying

**Cons**:
- Requires Terraform CLI installation
- State file must be managed carefully (remote backend required for team use)
- Provider versions can introduce breaking changes

---

## Option 3: GCP Deployment Manager

**What it is**: GCP-native declarative IaC using YAML + Jinja2 templates.

**Used for**: GCP-only resources when Terraform is not preferred.

| Resource | Deployment Manager Type |
|----------|------------------------|
| Cloud Run | `gcp-types/run-v1` |
| Pub/Sub Topic | `gcp-types/pubsub-v1:projects.topics` |
| Pub/Sub Subscription | `gcp-types/pubsub-v1:projects.subscriptions` |

**Pros**:
- Native GCP support, no extra tooling
- Supports Jinja2 templates for reuse
- Integrated with GCP IAM and logging

**Cons**:
- GCP-only — cannot manage AWS resources
- Less community adoption compared to Terraform
- Some GCP services have limited Deployment Manager support

---

## Decision for SAWS

| Layer | Tool | Reason |
|-------|------|--------|
| AWS resources | **CloudFormation** | Native, reliable, no extra tooling for AWS-only stack |
| GCP resources | **Terraform** | Consistent with AWS layer, cross-cloud state management |
| GCP (alternative) | Deployment Manager | Used as fallback YAML reference |

**Primary recommendation**: Use **Terraform** for both clouds to keep infrastructure in one place
and simplify CI/CD pipeline (`deploy-aws` and `deploy-gcp` stages can share tooling).

---

## How IaC Fits Into the SAWS CI/CD Pipeline

The `.gitlab-ci.yml` pipeline includes dedicated deploy stages that run IaC automatically:

```
push to main
    → lint & test
    → build React container
    → deploy-aws: terraform apply (AWS resources)
    → deploy-gcp: terraform apply (GCP resources)
```

This means every merge to `main` automatically provisions or updates cloud infrastructure,
eliminating manual console work.

---

## References

- AWS CloudFormation Documentation: https://docs.aws.amazon.com/cloudformation/
- Terraform AWS Provider: https://registry.terraform.io/providers/hashicorp/aws/latest/docs
- Terraform Google Provider: https://registry.terraform.io/providers/hashicorp/google/latest/docs
- GCP Deployment Manager Documentation: https://cloud.google.com/deployment-manager/docs
- Terraform vs CloudFormation comparison: https://developer.hashicorp.com/terraform/intro/vs/cloudformation
