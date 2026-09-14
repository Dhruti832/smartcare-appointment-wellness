
## 1. Frontend Framework: Why React and How We Should Set It Up

### 1.1 Choosing the Framework

The project spec says React or a similar framework, so we looked at the realistic options: React, Vue.js, Angular, and Svelte. Here's where we landed and why.

**React** made the most sense for SAWS specifically. The biggest reason is AWS Amplify — since Module 1 is using AWS Cognito for authentication, the `@aws-amplify/ui-react` library gives us pre-built login components that handle the Cognito flow without having to write it from scratch. That saves a lot of time. we checked the Amplify docs and the React integration is by far the most complete and up-to-date one they offer.

The second reason is component reuse. We have three user types (Guest, Patient, Coordinator) but a lot of shared UI — the navigation bar, the chatbot widget, appointment cards. In React, you build those once as components and plug them in wherever needed. That matters a lot in a 2.5-month timeline.

We briefly looked at Vue.js — it has a gentler learning curve and we've seen people say it's easier to pick up. But the Amplify + Vue integration is noticeably less documented, and the component library ecosystem isn't as mature. For a project that's already complex on the backend side, we didn't want to add frontend uncertainty on top of that.

Angular felt like overkill. It's TypeScript-first and has a steep learning curve for anyone not already familiar with it. Svelte is interesting but the ecosystem is too small — if you hit a problem, there's much less community help available.

### 1.2 Vite vs Create React App — This One Was Straightforward

When we started looking into this, we expected it to be a closer comparison. It wasn't.

Create React App (CRA) is essentially abandoned at this point. The last major update was in 2023 and the React team's own documentation no longer recommends it. When we looked at the GitHub repo, the issues backlog is enormous and there's been very little activity. The React docs now point people to Vite or Next.js.

Next.js is powerful but it's built around server-side rendering, and our entire backend is Lambda functions and Cloud Functions — we don't need SSR. It would add unnecessary complexity.

**Vite** is the right call. It uses ESBuild under the hood which makes the development server start almost instantly and hot module replacement actually fast. It also produces smaller production bundles by default because of better tree-shaking. The config file (`vite.config.js`) is simple and readable — no hidden webpack config that you have to eject to modify.

| Feature | Create React App | Vite |
|---------|-----------------|------|
| Dev server startup | Slow (30s+ on larger projects) | Near instant |
| Hot reload speed | Moderate | Very fast |
| Production bundle size | Larger defaults | Leaner, better tree-shaking |
| Config access | Hidden webpack (need to eject) | Simple `vite.config.js` |
| Maintenance status | Effectively deprecated | Actively maintained |
| Docker build compat | Works | Works |
| Community direction | Moving away | Now the standard |

Setting it up is one command:

```bash
npm create vite@latest saws-frontend -- --template react
cd saws-frontend
npm install
npm run dev
```


### 1.3 Libraries We'll Need

We went through each module and figured out what we actually need. We tried not to over-install things — every extra library is something that can break or go stale.

| Library | Version | Why We Need It |
|---------|---------|----------------|
| `react-router-dom` | v6 | Routing between Guest, Patient, Coordinator pages |
| `aws-amplify` | v6 | Cognito auth, API Gateway integration |
| `@aws-amplify/ui-react` | v6 | Pre-built Cognito sign-in components |
| `axios` | v1.x | HTTP calls to Lambda via API Gateway — supports interceptors for auth tokens |
| `recharts` | v2 | Charts for the analytics page (appointment trends, service popularity) |
| `react-hook-form` | v7 | Form validation — registration, booking, feedback forms |
| `date-fns` | v3 | Date formatting for appointment times |
| `react-hot-toast` | v2 | Toast notifications for confirmations and errors |
| `tailwindcss` | v3 | Styling |

On the styling question — we went with Tailwind CSS instead of a full component library like Material UI or Ant Design. Material UI imposes a very specific visual design language (Google Material) that's hard to override cleanly. For a healthcare platform with a custom design, Tailwind gives more control without fighting the framework. It also has a much smaller final bundle since it purges unused styles at build time.

### 1.4 How the Frontend Talks to the Backend

The frontend connects to backend services in three ways:

1. **AWS Amplify Auth** handles the Cognito sign-in (Stage 1 MFA). Amplify manages the tokens and session automatically.
2. **Axios** handles all other API calls — Stage 2 and 3 of MFA, appointment booking and retrieval, feedback submission. These all go through API Gateway which triggers the corresponding Lambda functions.
3. The **chatbot widget** (Module 2, Dialogflow) will be embedded separately — either as an iframe or using the Dialogflow Messenger script tag. We need to coordinate with the chatbot team on this in Sprint 2.

Environment variables (these never go in the repo — `.env` is in `.gitignore`):

```
VITE_API_GATEWAY_URL=https://<api-id>.execute-api.us-east-1.amazonaws.com/prod
VITE_COGNITO_USER_POOL_ID=us-east-1_XXXXXXX
VITE_COGNITO_CLIENT_ID=XXXXXXXXXXXXXXXX
VITE_GCP_CLOUD_RUN_URL=https://saws-frontend-<hash>-uc.a.run.app
```

### 1.5 Dockerfile

The React app gets containerized so it can be deployed to either Fargate or Cloud Run. We used a multi-stage build to keep the final image small — the first stage builds the app with Node, the second stage serves the static output with nginx. No Node.js runtime in the production image.

```dockerfile
# Stage 1: Build the React app
FROM node:18-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

# Stage 2: Serve with nginx
FROM nginx:stable-alpine
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
```

The resulting image is around 25-30MB compared to 300MB+ if you ran Node in production. Worth doing.

---

## 2. Deployment: AWS Fargate vs GCP Cloud Run

### 2.1 The Question

The containerized React app has to run somewhere. The project spec gives two options: AWS Fargate and GCP Cloud Run. We spent time going through the docs and pricing pages for both before settling on a recommendation.

### 2.2 Side-by-Side Comparison

| Feature | AWS Fargate | GCP Cloud Run |
|---------|------------|---------------|
| Type | Serverless containers (ECS-based) | Serverless containers |
| Pricing model | Per vCPU + memory per second | Per request + CPU/memory per second |
| Cold start | Minimal if min instances > 0 | ~1-2 sec if scaled to zero |
| Scale to zero | Possible but needs config | Default behaviour |
| Auto-scaling | Yes (ECS service scaling) | Yes, built-in and fast |
| Container registry | ECR (Elastic Container Registry) | Artifact Registry |
| HTTPS | Needs an ALB in front | Built-in, automatic |
| Custom domain | Through ALB / Route53 | Easy, built-in |
| CI/CD from GitLab | ECR push → ECS task update | Artifact Registry push → `gcloud run deploy` |
| Networking setup | VPC, subnets, security groups | Fully managed, no VPC needed |
| Monitoring | CloudWatch | Cloud Logging + Cloud Monitoring |
| Same-cloud as auth | Yes (Cognito, Lambda, SQS in same AWS account) | No — cross-cloud API calls needed |
| Est. cost (low traffic) | ~$5–15/month + ~$16/month for ALB | Free tier covers most student usage |

### 2.3 AWS Fargate

Fargate lets you run Docker containers without managing EC2 instances — you define the CPU and memory in a Task Definition, and ECS handles the rest. For a rolling deployment (zero downtime), you push a new image to ECR and ECS gradually replaces old containers with new ones.

The main appeal is that it stays entirely within AWS. Since Cognito, Lambda, SQS, and SNS are all in the same AWS account, IAM permissions are simpler — no cross-cloud authentication needed.

The problem is the setup complexity. Fargate on its own doesn't give you a public HTTPS URL — you need an Application Load Balancer (ALB) in front of it, which means configuring a VPC, subnets, security groups, target groups, and listener rules. That's a lot of infrastructure work before you even see the app running. The ALB also costs around $16/month minimum regardless of traffic, which adds up.

For a React frontend that's ultimately just serving static files, this is genuinely overkill.

### 2.4 GCP Cloud Run

Cloud Run is designed for exactly this use case. You push a container image, run one command, and get a public HTTPS URL back. Auto-scaling, load balancing, and TLS are all handled by GCP automatically.

```bash
gcloud run deploy saws-frontend \
  --image us-central1-docker.pkg.dev/PROJECT_ID/saws/frontend:latest \
  --platform managed \
  --region us-central1 \
  --allow-unauthenticated
```

That's the entire deployment. No VPC config, no load balancer, no listener rules.

The free tier is also genuinely generous — 2 million requests per month and 360,000 GB-seconds of memory per month. For a student project with limited concurrent users, we won't touch those limits.

The one trade-off is cold starts. If the container scales to zero after a period of inactivity, the first request can take 1-2 seconds while it boots. For a web frontend that's a noticeable delay, but in practice it only happens after the service has been idle for a while. For demos and regular usage it's fine. If it becomes an issue, setting a minimum of 1 instance prevents it (at the cost of a small constant bill).

---

## 3. Summary of Decisions

To keep things clear for the team going into Sprint 2, here's a quick summary of everything decided:

| Decision | Choice | Short Reason |
|----------|--------|--------------|
| Frontend framework | React (Vite) | CRA is deprecated; Amplify has best React integration |
| Styling | Tailwind CSS | Flexible, smaller bundle, no design-system lock-in |
| Auth client | AWS Amplify v6 | Native Cognito support, pre-built components |
| HTTP client | Axios | Interceptors for attaching auth tokens on every request |
| Charts | Recharts | Lightweight, React-native, good for our analytics page |
| Container deployment | GCP Cloud Run | Simpler setup, free tier, no ALB config needed |
| Container registry | GCP Artifact Registry | Required for Cloud Run |
| CI/CD deployment | GitLab → Artifact Registry → Cloud Run | One `gcloud run deploy` command in pipeline |

---

## 4. What Still Needs to Be Figured Out (Next Steps for Sprint 2)

A few things we couldn't finalize during Sprint 1 because they depend on what other team members set up:

- Need the API Gateway base URL and Cognito Pool ID + Client ID from the auth team (Module 1) before we can configure the Axios base URL and Amplify config
- Need to confirm with the chatbot team (Module 2) how the Dialogflow widget gets embedded — options are an iframe or the Dialogflow Messenger `<script>` tag, each has different layout implications
- The Cloud Run service still needs to be provisioned in GCP — the Terraform config is already in `infrastructure/gcp/terraform/` so this should be straightforward
- Priority for Sprint 2 build order: Login flow first (all pages depend on auth), then Patient Dashboard, then Coordinator Dashboard, then Guest pages
- Will add wireframes for the remaining screens (MFA stages, booking form, analytics) once the backend API contract is clearer

---