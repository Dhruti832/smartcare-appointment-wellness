terraform {
  required_version = ">= 1.5"
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
    archive = {
      source  = "hashicorp/archive"
      version = "~> 2.4"
    }
  }
  backend "s3" {
    bucket = "saws-terraform-state"
    key    = "aws/terraform.tfstate"
    region = "us-east-1"
  }
}

provider "aws" {
  region = var.aws_region
}

variable "aws_region" {
  default = "us-east-1"
}

variable "environment" {
  default = "dev"
}

# Exact browser origins allowed to call the SAWS APIs (CORS allow-list). No
# wildcard -- only the deployed frontend and local dev. Shared by both the auth
# API (auth.tf) and the appointments API (appointments.tf) so they can't drift.
variable "frontend_origins" {
  description = "Browser origins permitted by CORS on both APIs."
  type        = list(string)
  default = [
    "http://localhost:3000",
    "https://saws-frontend-dev-hhuecvmxwq-uc.a.run.app",
    "http://saws-frontend-dev-130673502.us-east-1.elb.amazonaws.com",
  ]
}

# ── Cognito ───────────────────────────────────────────────────────────────────
resource "aws_cognito_user_pool" "saws" {
  name = "saws-user-pool-${var.environment}"

  password_policy {
    minimum_length    = 8
    require_uppercase = true
    require_lowercase = true
    require_numbers   = true
  }

  auto_verified_attributes = ["email"]
}

resource "aws_cognito_user_pool_client" "web" {
  name         = "saws-web-client"
  user_pool_id = aws_cognito_user_pool.saws.id

  # ADMIN_USER_PASSWORD_AUTH lets the stage-1 Lambda verify credentials
  # server-side (admin_initiate_auth) using its IAM role. The client-facing
  # USER_PASSWORD_AUTH flow is intentionally NOT enabled, so a caller cannot
  # authenticate directly against Cognito and obtain a token that bypasses MFA
  # stages 2 & 3 -- every token must come through the full 3-stage API flow.
  explicit_auth_flows = [
    "ALLOW_ADMIN_USER_PASSWORD_AUTH",
    "ALLOW_REFRESH_TOKEN_AUTH",
  ]
}
