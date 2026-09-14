import json
import os

import boto3

sns = boto3.client('sns')
dynamodb = boto3.resource('dynamodb')
appointments_table = dynamodb.Table(os.environ.get('APPOINTMENTS_TABLE_NAME', 'saws-appointments'))

SNS_TOPIC_ARN = os.environ.get('SNS_TOPIC_ARN', '')

NOTIFICATION_TEMPLATES = {
    'BOOK': 'Your appointment {ref} has been confirmed for {date} at {time}.',
    'APPROVE': 'Your appointment {ref} for {date} at {time} has been approved by a wellness coordinator.',
    'REJECT': 'Your appointment request {ref} for {date} at {time} could not be approved. '
              'Please book another slot.',
    'CANCEL': 'Your appointment {ref} has been cancelled.',
    'REMINDER': 'Reminder: You have an appointment {ref} tomorrow at {time}.',
    'REGISTER': 'Welcome to SAWS! Your account has been created successfully.',
    'LOGIN': 'You have successfully logged in to SAWS.',
}

# Actions whose message needs the appointment's date/time, so the row is read
# from DynamoDB before the template is formatted. APPROVE/REJECT are enqueued
# by the coordinator decision handlers (approve_appointment/reject_appointment).
APPOINTMENT_ACTIONS = ('BOOK', 'APPROVE', 'REJECT', 'CANCEL', 'REMINDER')


def lambda_handler(event, context):
    """Triggered by SQS. Formats the templated message for the event's action
    and publishes it to SNS (email subscribers)."""
    for record in event.get('Records', []):
        message = json.loads(record['body'])
        action = (message.get('action') or '').upper()
        appointment_id = message.get('appointmentId')
        patient_id = message.get('patientId')

        if action not in NOTIFICATION_TEMPLATES:
            print(f'Skipping record with unknown action: {action!r}')
            continue

        appt = {}
        if action in APPOINTMENT_ACTIONS and appointment_id:
            appt = appointments_table.get_item(
                Key={'appointmentId': appointment_id}
            ).get('Item') or {}

        text = NOTIFICATION_TEMPLATES[action].format(
            ref=appointment_id or 'N/A',
            date=appt.get('date', ''),
            time=appt.get('time', ''),
        )

        sns.publish(
            TopicArn=SNS_TOPIC_ARN,
            Message=text,
            Subject=f'SAWS - {action.capitalize()} Notification',
            MessageAttributes={
                'patientId': {'DataType': 'String', 'StringValue': patient_id or 'unknown'},
            },
        )

    return {'statusCode': 200}
