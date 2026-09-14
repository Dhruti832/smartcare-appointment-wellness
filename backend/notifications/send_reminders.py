import json
import os
from datetime import datetime, timedelta, timezone

import boto3
from boto3.dynamodb.conditions import Key

sqs = boto3.client('sqs')
dynamodb = boto3.resource('dynamodb')
appointments_table = dynamodb.Table(os.environ.get('APPOINTMENTS_TABLE_NAME', 'saws-appointments'))

NOTIFICATIONS_QUEUE_URL = os.environ.get('NOTIFICATIONS_QUEUE_URL', '')
REMINDER_LEAD_DAYS = int(os.environ.get('REMINDER_LEAD_DAYS', '1'))

# Only appointments the patient is still expected to attend are worth a
# reminder; REJECTED and CANCELLED rows are skipped.
REMINDABLE_STATUSES = ('PENDING', 'APPROVED')
STATUS_DATE_INDEX = 'status-date-index'


def lambda_handler(event, context):
    """Triggered daily by EventBridge. Finds every appointment scheduled
    REMINDER_LEAD_DAYS ahead and enqueues one REMINDER event per appointment,
    which process_notification then turns into an email.

    This replaces the Sprint 2 prototype, where the EventBridge rule put a
    single static REMINDER payload on the queue with no appointmentId — one
    generic 'appointment N/A' email a day, regardless of what was booked.
    """
    target_date = (
        datetime.now(timezone.utc) + timedelta(days=REMINDER_LEAD_DAYS)
    ).strftime('%Y-%m-%d')

    appointments = []
    for status in REMINDABLE_STATUSES:
        appointments.extend(query_by_status_and_date(status, target_date))

    for appointment in appointments:
        enqueue_reminder(appointment)

    print(f'Queued {len(appointments)} reminder(s) for {target_date}')
    return {'statusCode': 200, 'date': target_date, 'reminders': len(appointments)}


def query_by_status_and_date(status, target_date):
    """Reads the status-date GSI (hash: status, range: date), following
    pagination so a busy day is not silently truncated at 1 MB."""
    items = []
    start_key = None

    while True:
        kwargs = {
            'IndexName': STATUS_DATE_INDEX,
            'KeyConditionExpression': Key('status').eq(status) & Key('date').eq(target_date),
        }
        if start_key:
            kwargs['ExclusiveStartKey'] = start_key

        result = appointments_table.query(**kwargs)
        items.extend(result.get('Items', []))

        start_key = result.get('LastEvaluatedKey')
        if not start_key:
            return items


def enqueue_reminder(appointment):
    if not NOTIFICATIONS_QUEUE_URL:
        return
    sqs.send_message(
        QueueUrl=NOTIFICATIONS_QUEUE_URL,
        MessageBody=json.dumps({
            'action': 'REMINDER',
            'appointmentId': appointment.get('appointmentId'),
            'patientId': appointment.get('patientUsername'),
        }),
    )
