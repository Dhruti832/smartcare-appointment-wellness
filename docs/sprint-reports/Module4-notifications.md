# Sprint 1 Research – Notifications (Module 4)

**Services researched:** AWS SNS, AWS SQS, AWS EventBridge Scheduler

---

## 1. What we need to build

Five notifications must be sent to patients: successful registration, successful login, appointment confirmation, appointment cancellation, and appointment reminder. 

The project document also suggests the workflow: appointment request enters SQS -> Lambda validates it -> SNS sends the notification.

## 2. How SNS and SQS fit together

SQS is a message queue: the frontend drops a booking request into it and a Lambda picks it up and processes it. The benefit is that the frontend does not have to wait, and if the Lambda fails or there is a traffic spike, requests just sit in the queue instead of getting lost. 

SNS works the other way around, it is publish/subscribe: we publish a message to a topic and SNS pushes it out to whoever is subscribed (email addresses, phone numbers, other Lambdas).

So in our system the two have separate jobs: SQS makes sure the appointment request is handled safely, and SNS does the actual delivery to the patient.

## 3. Booking notification flow

```
React frontend
     |  POST /appointments
     v
API Gateway
     v
SQS queue (appointment-requests)
     |  (triggers Lambda automatically)
     v
Lambda: validate request
     |-- invalid --> Dead Letter Queue (DLQ)
     v
Write appointment to DynamoDB
     |
     v
Publish to SNS topic
     |
     v
Email to patient
```

Registration and login notifications skip the queue. There is nothing to validate or approve there, so the auth Lambda (Module 1) can just publish directly to the SNS topic after a successful sign-up or login.

## 4. Design decisions we made

- **Standard queue, not FIFO.** SQS offers two queue types. FIFO guarantees exactly-once delivery, which sounds attractive because a duplicated message could mean a double booking. But FIFO is slower and more restrictive, and the same problem can be solved in code: the validation Lambda checks DynamoDB whether this request ID was already processed before doing anything. With that check in place the simpler standard queue is good enough for us.
- **One SNS topic, not five.** We could make a separate topic per notification type, but then every patient needs five subscriptions. Instead we use a single topic where each message carries a `notificationType` attribute (`REGISTRATION`, `LOGIN`, `CONFIRMATION`, `CANCELLATION`, `REMINDER`). The auth module will publish to this same topic, so agreeing on this format early matters for the whole team.
- **Dead Letter Queue with maxReceiveCount of 3.** If a message keeps failing (bad data, a bug), SQS would otherwise retry it forever and quietly block the queue. After 3 failed attempts the message moves to the DLQ where we can look at it. This also gives us something concrete to show for the queue/message testing required in the project document.

## 5. Problem: reminders need a scheduler

This was the biggest finding in this module. SNS sends immediately, and SQS can delay a message by at most 15 minutes. But a reminder has to go out around 24 hours before an appointment that might be booked weeks in advance. So neither service can do reminders on its own, and our current diagram has no component for this.

Options we considered:

- **EventBridge Scheduler (chosen).** When an appointment is confirmed, the Lambda creates a one-time schedule for (appointment time minus 24h). At that moment EventBridge triggers a small reminder Lambda that publishes to our SNS topic. If the appointment gets cancelled we delete the schedule. The free tier is 14M invocations a month, so it costs us nothing.
- **Cron Lambda** that runs every hour and scans DynamoDB for appointments coming up in the next 24 hours. Easier to understand, but it runs even when there is nothing to send and needs an extra "reminderSent" flag in the table.

We will add EventBridge Scheduler to the architecture in Sprint 2.

## 6. Why we are skipping SMS

We first assumed notifications would go out by both email and SMS, but after reading the SNS docs, SMS turned out to be a headache for a course project. New AWS accounts sit in an "SMS sandbox" where only manually verified phone numbers can receive texts, getting out of it needs a support request to AWS, and there is a 1 USD default monthly spend cap plus extra requirements for sending to Canadian numbers.

Email has none of these problems and is free at our volume. The one catch is that SNS email subscribers must click a confirmation link once before they receive anything, so during testing we have to register, confirm that email, and only then test notifications. If we want nicer HTML emails later, AWS SES would be the upgrade, but plain SNS email already satisfies the requirements.

## 7. Cost

Everything in this module fits in the free tier at our scale: SQS and SNS each give 1M requests/publishes per month, SNS includes 1,000 free email deliveries, Lambda gives 1M invocations, and EventBridge Scheduler gives 14M.

---

## 8. Conclusion – what we decided

- Notifications: SQS standard queue + validation Lambda + a single SNS topic, with a DLQ for failed messages. EventBridge Scheduler handles appointment reminders, since SNS/SQS alone cannot schedule that far ahead.
- Email-only notifications for the demo. The AWS SMS sandbox and its restrictions are not worth it for a course project.
- One architecture change carried into Sprint 2: adding EventBridge Scheduler to the diagram.

## 9. References

- AWS SQS Developer Guide (queue types, dead-letter queues)
- AWS SNS Developer Guide (topics, message attributes, email endpoints, SMS sandbox)
- Amazon EventBridge Scheduler User Guide (one-time schedules)
