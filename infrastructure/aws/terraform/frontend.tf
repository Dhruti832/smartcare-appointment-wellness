# Frontend deployment: containerized React app on ECS Fargate behind an ALB,
# per the project's "Deployment using AWS Fargate" requirement.

variable "frontend_image_tag" {
  description = "Tag of the frontend image in ECR to run. Bump this after pushing a new build."
  default     = "latest"
}

# Learner Lab provides a default VPC with public subnets in every AZ; we reuse
# it rather than standing up new networking (also keeps this within the
# permissions LabRole/the lab user actually has).
data "aws_vpc" "default" {
  default = true
}

data "aws_subnets" "default" {
  filter {
    name   = "vpc-id"
    values = [data.aws_vpc.default.id]
  }
}

resource "aws_ecr_repository" "frontend" {
  name         = "saws-frontend-${var.environment}"
  force_delete = true
}

resource "aws_cloudwatch_log_group" "frontend" {
  name              = "/ecs/saws-frontend-${var.environment}"
  retention_in_days = 7
}

# ── Networking / security ─────────────────────────────────────────────────────
resource "aws_security_group" "frontend_alb" {
  name        = "saws-frontend-alb-${var.environment}"
  description = "Allows public HTTP traffic to the frontend load balancer"
  vpc_id      = data.aws_vpc.default.id

  ingress {
    from_port   = 80
    to_port     = 80
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }
}

resource "aws_security_group" "frontend_task" {
  name        = "saws-frontend-task-${var.environment}"
  description = "Allows the frontend ALB to reach the Fargate task nginx port"
  vpc_id      = data.aws_vpc.default.id

  ingress {
    from_port       = 8080
    to_port         = 8080
    protocol        = "tcp"
    security_groups = [aws_security_group.frontend_alb.id]
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }
}

# ── Load balancer ──────────────────────────────────────────────────────────────
resource "aws_lb" "frontend" {
  name               = "saws-frontend-${var.environment}"
  internal           = false
  load_balancer_type = "application"
  security_groups    = [aws_security_group.frontend_alb.id]
  subnets            = data.aws_subnets.default.ids
}

resource "aws_lb_target_group" "frontend" {
  # name_prefix (max 6 chars) + create_before_destroy instead of a fixed name:
  # a fixed name deadlocks on any future in-place-incompatible change (e.g.
  # this port migration) because Terraform can't create the replacement
  # under the same name until the old one is deleted, and can't delete the
  # old one while the listener still references it.
  name_prefix = "sawsf-"
  port        = 8080
  protocol    = "HTTP"
  vpc_id      = data.aws_vpc.default.id
  target_type = "ip"

  health_check {
    path                = "/"
    healthy_threshold   = 2
    unhealthy_threshold = 5
    interval            = 30
    timeout             = 10
  }

  lifecycle {
    create_before_destroy = true
  }
}

resource "aws_lb_listener" "frontend" {
  load_balancer_arn = aws_lb.frontend.arn
  port              = 80
  protocol          = "HTTP"

  default_action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.frontend.arn
  }
}

# ── ECS (Fargate) ──────────────────────────────────────────────────────────────
resource "aws_ecs_cluster" "saws" {
  name = "saws-cluster-${var.environment}"
}

resource "aws_ecs_task_definition" "frontend" {
  family                   = "saws-frontend-${var.environment}"
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = "256"
  memory                   = "512"
  execution_role_arn       = data.aws_iam_role.lab_role.arn
  task_role_arn            = data.aws_iam_role.lab_role.arn

  container_definitions = jsonencode([
    {
      name      = "frontend"
      image     = "${aws_ecr_repository.frontend.repository_url}:${var.frontend_image_tag}"
      essential = true
      portMappings = [
        { containerPort = 8080, protocol = "tcp" }
      ]
      logConfiguration = {
        logDriver = "awslogs"
        options = {
          "awslogs-group"         = aws_cloudwatch_log_group.frontend.name
          "awslogs-region"        = var.aws_region
          "awslogs-stream-prefix" = "frontend"
        }
      }
    }
  ])
}

resource "aws_ecs_service" "frontend" {
  name            = "saws-frontend-${var.environment}"
  cluster         = aws_ecs_cluster.saws.id
  task_definition = aws_ecs_task_definition.frontend.arn
  desired_count   = 1
  launch_type     = "FARGATE"

  network_configuration {
    subnets          = data.aws_subnets.default.ids
    security_groups  = [aws_security_group.frontend_task.id]
    assign_public_ip = true
  }

  load_balancer {
    target_group_arn = aws_lb_target_group.frontend.arn
    container_name   = "frontend"
    container_port   = 8080
  }

  depends_on = [aws_lb_listener.frontend]
}

output "frontend_url" {
  value = "http://${aws_lb.frontend.dns_name}"
}

output "ecr_repository_url" {
  value = aws_ecr_repository.frontend.repository_url
}