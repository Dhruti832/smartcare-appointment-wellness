# Architecture Decisions - SAWS (SmartCare Appointment & Wellness System)

This document records the architectural decisions made during Sprint 1, the alternatives we considered and rejected, the assumptions we are working under, and the open questions and risks we have identified. It complements the Sprint 1
report: the report states *what* the architecture is, while this document captures *why* we chose it and *what is still open*.

## 1. Design Constraints and Requirements

Before selecting technologies and defining the system architecture, the team reviewed the project requirements to determine which components were mandatory and which allowed flexibility in implementation.

### Mandatory Components

The following technologies were explicitly required by the project specification:

- AWS Cognito for user authentication and multi-factor authentication.
- AWS SNS and SQS for notification delivery and asynchronous notification processing.
- Google Cloud Pub/Sub for message passing between services.

Because both AWS and Google Cloud services are mandated, the system inherently operates in a multi-cloud environment.

### Flexible Components

Several architectural components were left to the team's discretion:

- Chatbot platform (AWS Lex or Google Dialogflow)
- Sentiment analysis service (AWS Comprehend or Google Natural Language API)
- Analytics and reporting tools (Amazon QuickSight or Google Looker Studio)
- Deployment platform (AWS Fargate or Google Cloud Run)
- Database technologies (DynamoDB or Firestore)

The decisions discussed in the following sections focus on these configurable elements.

# 2. Multi-Cloud Distribution Strategy

One of the most significant architectural decisions involved determining how system modules should be distributed across AWS and Google Cloud Platform.

After evaluating multiple alternatives, the team adopted a balanced deployment strategy in which the six major system modules are distributed evenly across both cloud providers.

## Final Distribution

### AWS
Authentication and Multi-Factor Authentication
Notification Services
Appointment Management and Scheduling Data

### Google Cloud Platform
Chatbot Services
Message Passing Services
Analytics and Reporting Services
Frontend Deployment

### Rationale
Rather than distributing individual services across clouds, the team chose to keep complete modules together within a single cloud environment.

This approach provides several advantages:

- Reduced cross-cloud communication.
- Lower network latency.
- Simplified identity and access management.
- Easier maintenance and troubleshooting.
- Better data locality between related services.

By keeping module components together, each module can use a common runtime environment and data store, reducing unnecessary complexity.

### Alternative Considered

The team also considered an AWS-heavy architecture where most services would reside on AWS and Google Cloud would only host the mandatory Pub/Sub service.

Although this option would simplify deployment and reduce integration complexity, it could be interpreted as only minimally satisfying the multi-cloud requirement. Since demonstrating meaningful **multi-cloud integration** is an important project objective, the balanced distribution was selected.

### Decision Outcome

The balanced architecture provides clear evidence of multi-cloud deployment while maintaining manageable integration complexity. The team believes this approach offers the best balance between technical simplicity and project requirements.

# 3. Chatbot Platform Selection

The chatbot is responsible for assisting users with appointment inquiries, providing support information, and forwarding patient concerns to healthcare coordinators.

After evaluating AWS Lex and Google Dialogflow, the team selected Google Dialogflow.

### Reasons for Selecting Dialogflow

The chatbot works closely with the messaging subsystem, which is already built around Google Cloud Pub/Sub.

By placing both services within Google Cloud:

- Dialogflow can communicate directly with Pub/Sub.
- Cloud Functions can process chatbot-generated events locally.
- Firestore can be used as a shared storage layer.
- Cross-cloud communication for concern forwarding is eliminated.

This creates a streamlined workflow in which patient concerns submitted through the chatbot can be immediately forwarded to coordinators through the messaging infrastructure.

### Trade-Off

The chatbot occasionally requires appointment information, which is maintained on AWS.

As a result, appointment data must be made available to Google Cloud services. The team accepted this trade-off because it introduces only a single cross-cloud integration point while preserving strong cohesion between the chatbot and messaging modules.

# 4. Cross-Cloud Appointment Data Integration

A key architectural challenge arises because appointment records are stored in AWS DynamoDB, while both the chatbot and analytics services operate within Google Cloud.

### Problem Statement

The chatbot requires appointment details to support appointment lookup functionality, and the analytics module requires appointment data for reporting and trend analysis.

The team evaluated two possible solutions.

### Option 1: Live Cross-Cloud API Calls

Under this approach, Google Cloud services would directly call AWS APIs whenever appointment information was needed.

### Advantages
- Data is always retrieved from the authoritative source.
- No duplicate data storage.

### Disadvantages
- Increased network latency.
- Higher dependency on cloud-to-cloud connectivity.
- More complex credential management.
- Greater risk of service disruption if either cloud experiences connectivity issues.

### Option 2: Event-Driven Data Mirror (Selected)

The **chosen** solution uses an event-driven architecture.

Whenever an appointment is created or updated in AWS:

- An event is generated.
- A serverless AWS component processes the event.
- A lightweight appointment record is replicated to Firestore.
- Google Cloud services access the local Firestore copy.

### Reasons for Selection

This approach offers several advantages:

- Improved resilience.
- Reduced latency for chatbot and analytics operations.
- Fewer real-time dependencies between clouds.
- Simplified authentication requirements.
- Easier demonstration and testing during project evaluation.

Only essential appointment information is replicated, ensuring that AWS remains the authoritative source of appointment data while Google Cloud maintains a lightweight read-only representation.

This integration point is considered the most critical component of the system and will receive additional testing and validation in future sprints.

See `docs/architecture/architecture-diagram.md` for the as-built diagram of this mirror (and the
feedback mirror added in §9 below) against the actual Terraform/Lambda code, not just this prose
description.

# 5. Design Enhancements Identified for Future Iterations

During architectural review sessions, several improvements were identified that require further refinement in Sprint 2.

### Dedicated Booking Service

The booking process currently appears simplified in the high-level architecture.

A dedicated booking service will be introduced to:

- Validate appointment availability.
- Create appointment requests.
- Store appointments with an initial pending status.
- Trigger downstream processing.

Separating booking logic from notification processing improves maintainability and follows the principle of separation of concerns.

### Coordinator Approval Workflow

The project requires coordinators to approve or reject appointment requests.

A dedicated approval workflow will therefore be designed to:

- Update appointment status.
- Trigger confirmation notifications.
- Trigger cancellation notifications when necessary.
- Maintain a complete audit trail of appointment decisions.
- DynamoDB Data Organization

The architecture diagram currently represents user and appointment storage separately.

In implementation, both datasets will exist as individual tables within a single DynamoDB service rather than separate database instances.

This clarification will be reflected in future architectural diagrams.

# 6. Key Assumptions

The current architecture is based on several assumptions:

- User authentication tokens are managed by the frontend after successful login.
- Backend services trust validated Cognito-issued tokens.
- The Caesar cipher security feature stores a user-specific shift value alongside account data.
- Coordinator assignment for patient concerns is performed randomly, as specified in project requirements.
- Analytics dashboards are accessible to all user roles, including guests.

These assumptions will be validated with stakeholders during subsequent development phases.

# 7. Risks and Open Questions

Several risks and unresolved questions were identified during architectural planning.

## Cross-Cloud Data Synchronization

The event-driven appointment mirror represents the most critical integration point in the system.

Any synchronization failure could affect both chatbot functionality and analytics reporting.

## Sentiment Analysis Processing

The team must determine whether sentiment analysis should occur:

Immediately after each feedback submission, or
In periodic batch-processing jobs.

This decision impacts operational cost, system complexity, and dashboard freshness.

## Real-Time Chat Feature

The project specification includes a real-time communication feature.

The team must determine whether this functionality will be implemented as part of the core deliverable or treated as an advanced enhancement.

## Identity and Access Management

A formal strategy for managing credentials and permissions across AWS and Google Cloud environments remains under discussion.

## Analytics Platform Selection

The team currently favors Google Looker Studio because of its proximity to the analytics module and Firestore data.

However, Amazon QuickSight remains under evaluation.

# 8. Cost and Security Considerations

Cost efficiency and security were important factors influencing architectural decisions.

## Cost Considerations

Grouping related modules within the same cloud environment reduces:

- Cross-cloud network traffic.
- Data transfer charges.
- Request latency.

The event-driven synchronization model also minimizes unnecessary cloud-to-cloud communication.

## Security Considerations

Authentication remains entirely within AWS Cognito, reducing the complexity of cross-cloud identity validation.

Additionally, only limited appointment information is replicated to Google Cloud, minimizing the amount of sensitive data transferred across cloud boundaries and reducing overall exposure risk.

# 9. Sprint 2 Amendment: Feedback Storage Location

## Problem Statement

Sprint 1 decided feedback and sentiment analysis would live entirely on Google Cloud (Firestore
+ Google Natural Language API), reasoning that dashboards and sentiment results already lived on
GCP and an AWS-side feedback table would need a second cross-cloud transfer on top of the
appointment mirror (see §1.2/§2.3 of `docs/sprint-reports/Module5-sentiment-dashboards.md`).

During Sprint 2 database design, feedback was grouped with the other core patient-facing
entities (users, appointments, services, feedback) that the team scoped as one DynamoDB service.
Provisioning feedback separately on Firestore would split a tightly related entity away from the
appointment and service data it directly references.

## Options Reconsidered

**Option 1 — Feedback on Firestore (original Sprint 1 decision).** Sentiment results land
directly where the dashboard reads them, and no appointment-style mirror is needed for feedback
itself. However, every feedback submission would need to validate against AWS-side appointment
data (has this appointment completed, does it belong to this patient) — a live cross-cloud read
on every write, which is worse than the single cross-cloud transfer the original decision was
trying to avoid.

**Option 2 — Feedback on DynamoDB (adopted).** Feedback is stored in `saws-feedback` (AWS),
directly joinable to `saws-appointments` and `saws-services` with no cross-cloud call needed to
validate a submission. Sentiment analysis is performed by an AWS Lambda calling an external
sentiment API as a stateless outbound request, and the result is written back into the same
DynamoDB row. A lightweight copy (`feedbackText`, `sentimentScore`, `sentimentLabel`,
`serviceId`) is then mirrored to Firestore using the same event-driven mirror pattern already
built and validated for appointments (§4), so Looker Studio/BigQuery keep reading locally with
no live AWS dependency.

## Decision

Feedback moves to AWS DynamoDB (`saws-feedback`), extending the existing appointment mirror to
also carry a lightweight feedback and sentiment copy to Firestore.

## Rationale

- **Write-path cohesion.** Feedback's write path (submit, validate against the owning
  appointment/service, store) never leaves AWS, keeping the same single-cloud-per-write-path
  principle already used to justify the AWS/GCP module split (§2 Rationale: *"better data
  locality between related services"*).
- **No new integration pattern.** The read-side benefit Sprint 1 wanted — dashboards reading
  feedback locally on GCP — is preserved by reusing the mirror pattern already designed, built,
  and documented for appointments, rather than inventing a second, feedback-specific cross-cloud
  mechanism.
- **A sentiment API call is not the same class of problem as a database sync.** The original
  concern was ongoing data synchronization across clouds. A single outbound call to a sentiment
  API from a Lambda is a stateless request/response, structurally identical to calling any
  external SaaS API, and does not reintroduce the sync problem the mirror pattern solves.

## Trade-off Accepted

Sentiment analysis now makes one outbound API call per feedback submission rather than a purely
local one. If the sentiment engine stays on Google Natural Language API, this call crosses
clouds (AWS Lambda to Google); if it moves to AWS Comprehend instead — feasible now that
feedback data itself lives in AWS, and Comprehend is an equally valid option under the project
requirements — this trade-off disappears entirely. That engine choice belongs to whoever
implements sentiment analysis this sprint, not to this data-model decision.

## Implementation Note (Sprint 2, cross-cloud mirror pipeline)

This section originally assumed the feedback mirror would reuse "the same event-driven mirror
pattern already built and validated for appointments" (§4) unchanged. In practice it needed one
more hop: the appointments mirror can write to Firestore directly because AWS Workload Identity
Federation lets its Lambda exchange AWS credentials for a short-lived GCP token, but there is no
equivalent path in the other direction for a GCP Cloud Function to read DynamoDB directly.

The feedback mirror therefore runs as **Lambda export → S3 (CSV) → GCP Cloud Function →
Firestore**: `export_feedback_csv.py` (triggered by the same `saws-feedback` stream, once
`analyze_sentiment.py`'s own `UpdateItem` adds `sentimentLabel`) writes the scored row to S3 as
CSV and hands the GCP side a short-lived presigned URL instead of a standing credential; the
`feedbackMirror` Cloud Function (`analytics/functions`) fetches that URL and upserts the row into
Firestore's `feedback` collection. This preserves the same "no standing cross-cloud secret"
property the WIF-based appointments mirror has, just via an S3 hand-off rather than a GCP-native
identity exchange. See `docs/architecture/architecture-diagram.md` §2 for the sequence diagrams
of both mirrors side by side.

# Conclusion

The architectural decisions presented in this document were guided by three primary objectives:

- Satisfying the project's multi-cloud deployment requirements.
- Maintaining strong module cohesion and system simplicity.
- Minimizing cross-cloud complexity while preserving scalability and security.

The resulting architecture achieves a balanced distribution between AWS and Google Cloud, introduces a controlled and well-defined integration strategy, and provides a solid foundation for detailed design and implementation activities in future development sprints.