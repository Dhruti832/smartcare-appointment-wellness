# Sprint 1 — Meeting 1: Project Kickoff & Role Assignment

**Project:** SmartCare Appointment and Wellness System (SAWS)
**Team:** Serverless Squad
**Course:** CSCI 5410 / S26

| Field | Details |
|---|---|
| **Date** | June 2, 2026 |
| **Time** | 12:00 PM – 1:00 PM |
| **Platform** | In-person Meeting |
| **Attendees** | Akanksha Raut, Mansi Patil, Chahna Patel, Aditya Lad, Dhrutiben Patel, Dev Prajapati, Harsha Pilli |

---

## 1.1 Agenda

- Read and discuss the SAWS Project Requirement Document (PRD)
- Confirm team name and assign roles
- Divide Sprint 1 tasks among all 7 members based on roles
- Set up communication channels and agree on tools
- Confirm GitLab repository setup responsibilities

---

## 1.2 PRD Walkthrough

- The team read through the PRD and discussed the overall objective — building a serverless, multi-cloud healthcare appointment and wellness platform using AWS and GCP.
- The three user types were defined: Guests (browse only), Registered Patients (3-stage MFA, booking, notifications), and Wellness Coordinators (admin, approvals, analytics).
- The 3-stage MFA flow was noted as a key complexity: Stage 1 via Cognito (UserID/Password), Stage 2 via Lambda + DynamoDB (Security Q&A), Stage 3 via Lambda + DynamoDB (Caesar cipher code clue).
- The six modules were mapped out and mandatory service constraints identified — Cognito for auth, SNS/SQS for notifications, GCP Pub/Sub for message passing.
- The team agreed both AWS and GCP must be used deliberately across modules, not arbitrarily.

---

## 1.3 Role Assignment

Roles were assigned based on each member's strengths and interest:

| Member | Role | Sprint 1 Task |
|---|---|---|
| Akanksha Raut | Dev Director | Architecture diagram, service justification, multi-cloud deployment strategy |
| Mansi Patil | Tech Director | React setup research, Fargate vs Cloud Run, UI wireframes |
| Chahna Patel | Sr. Cloud Engineer | SNS/SQS research, AWS Comprehend / Google NLP, Looker Studio / QuickSight |
| Aditya Lad | Sr. Cloud Engineer | AWS Lex / Dialogflow research, GCP Pub/Sub + Firestore, API findings |
| Dhrutiben Patel | Sr. Cloud Engineer | Sprint 1 report, peer review coordination, GitLab board + milestones |
| Dev Prajapati | Sr. Cloud Engineer | AWS Cognito, DynamoDB, Lambda for MFA, Caesar cipher approach |
| Harsha Pilli | Sr. Cloud Engineer | GitLab repo setup, CI skeleton, issue boards, IaC documentation |

- **Dev Director:** Akanksha Raut nominated — strongest in system design and cloud architecture planning.
- **Tech Director:** Mansi Patil nominated — frontend experience and ability to coordinate technical delivery.
- **Sr. Cloud Engineers:** Remaining five members assigned, each owning a specific research domain for Sprint 1.

---

## 1.4 Communication & Tools

- **Discord** — primary async communication channel for daily updates and quick questions
- **Microsoft Teams** — scheduled video meetings
- **DAL FCS GitLab** — all code, documentation, research notes, and meeting logs
- **Branch naming convention:** `<type>/<member>/<description>` (e.g. `docs/dhruti/sprint1-report`)

---

## 1.5 Action Items

- [ ] Harsha Pilli — Set up GitLab repo structure and documents folder before next meeting
- [ ] Dhrutiben Patel — Create Sprint 1 milestone and open issues per member on the GitLab board
- [ ] All members — Begin reading official AWS/GCP documentation for assigned modules
- [ ] All members — Create personal `.md` research file in `/documents/research/` on GitLab

**Next meeting:** June 11, 2026

---

