# Sprint 1 — Meeting 2: Progress Review, Architecture & Final Submission

**Project:** SmartCare Appointment and Wellness System (SAWS)
**Team:** Serverless Squad
**Course:** CSCI 5410 / S26

| Field | Details |
|---|---|
| **Date** | June 11, 2026 |
| **Time** | 12:00 PM – 1:00 PM |
| **Platform** | Microsoft Teams |
| **Attendees** | Akanksha Raut, Mansi Patil, Chahna Patel, Aditya Lad, Dhrutiben Patel, Dev Prajapati, Harsha Pilli |

---

## 2.1 Agenda

- Each member provides a progress update on their assigned task
- Review and approve architecture diagram
- Confirm all service selection decisions
- Final review of the Sprint 1 report
- Confirm GitLab contributions and peer review process
- Brief Sprint 2 preview

---

## 2.2 Individual Progress Updates

Each member provided a status update as of June 11:

| Member | Role | Status | Notes |
|---|---|---|---|
| Akanksha Raut | Dev Director | ✅ Complete | Architecture diagram and architectural decision doc uploaded to GitLab |
| Mansi Patil | Tech Director | ✅ Complete | Fargate vs Cloud Run comparison done; all wireframes uploaded |
| Chahna Patel | Sr. Cloud Engineer | ✅ Complete | SNS/SQS, Comprehend, and Looker Studio notes uploaded |
| Aditya Lad | Sr. Cloud Engineer | ✅ Complete | Lex vs Dialogflow and Pub/Sub + Firestore notes uploaded |
| Dhrutiben Patel | Sr. Cloud Engineer | ✅ Complete | Sprint 1 report complete; all sections finalised and reviewed |
| Dev Prajapati | Sr. Cloud Engineer | ✅ Complete | Cognito, Lambda, DynamoDB, Caesar cipher notes uploaded |
| Harsha Pilli | Sr. Cloud Engineer | ✅ Complete | GitLab repo, issue board, CI skeleton, IaC doc in place |

---

## 2.3 Architecture Review & Service Decisions

- **Diagram:** Akanksha Raut presented the multi-cloud architecture diagram showing AWS and GCP domains, module placement, user flows, and the cross-cloud seam.
- **Cross-Cloud Strategy:** The event-driven mirror pattern was confirmed — when a booking is confirmed, the same Lambda event that triggers SNS also writes a thin appointment record (ref code, date, service, status) to Firestore, so GCP chatbot and analytics read locally without live calls into AWS.
- The 3/3 cloud split rationale confirmed: mandated services (Cognito, SNS/SQS, Pub/Sub) drove the initial split; remaining modules assigned to GCP to cluster services sharing data.
- **Final Decisions:**
  - Dialogflow confirmed over AWS Lex
  - Looker Studio confirmed over QuickSight
  - Event-driven mirror confirmed as cross-cloud integration strategy
- Architecture diagram approved — Akanksha to finalise and upload to GitLab.

---

## 2.4 Report Final Review

- Dhrutiben Patel walked the team through the completed Sprint 1 report — all nine sections reviewed together.
- Minor wording corrections made to Sections 3 and 7 based on team feedback.
- Section 8 confirmed to list specific documentation reviewed per service, not a blanket statement.
- Report confirmed within the 4-page limit. All team members approved the final version.

---

## 2.5 GitLab Contributions Check

Harsha Pilli confirmed the following were in place for all members:

- [x] Research MD files uploaded by all 7 members under `/documents/research/`
- [x] Architecture diagram and architectural decision document uploaded by Akanksha Raut
- [x] UI wireframes for all 3 user types uploaded by Mansi Patil
- [x] Issue board fully populated with tasks, assignees, and status labels
- [x] Sprint 1 milestone active with correct due date
- [x] CI skeleton committed and repo structure clean
- [x] Meeting notes uploaded under `/documents/meeting-notes/`

---

## 2.6 Sprint 2 Preview

The team briefly discussed Sprint 2 priorities:

- **Akanksha Raut** (Dev Director) — Lead backend architecture setup, oversee module integration
- **Mansi Patil** (Tech Director) — Scaffold React project, set up routing for all three user views
- **Dev Prajapati** — Begin Cognito user pool setup and Lambda trigger configuration for MFA
- **Aditya Lad** — Set up Dialogflow CX project and define initial intents and fulfilment webhooks
- **Chahna Patel** — Begin SNS/SQS queue configuration and Lambda notification handler
- **Dhrutiben Patel** — Begin DynamoDB table design for appointments and user profiles
- **Harsha Pilli** — Configure Terraform for initial AWS resource provisioning

---

## 2.7 Action Items

- [ ] All members — Ensure all research MD files are committed to GitLab
- [ ] All members — Submit peer review to Dhrutiben by end of day June 13
- [ ] Dhrutiben Patel — Compile peer reviews and submit Sprint 1 report
- [ ] Akanksha Raut — Finalise and upload architecture diagram
- [ ] Harsha Pilli — Close Sprint 1 issues and move pending items to Sprint 2 board
- [ ] All members — Begin Sprint 2 tasks as discussed

---
