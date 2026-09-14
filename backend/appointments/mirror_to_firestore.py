import csv
import io
import json
import os
import urllib.error
import urllib.request

import boto3
from boto3.dynamodb.types import TypeDeserializer

# Cross-cloud appointments mirror, AWS half. GCP can't read DynamoDB directly,
# so this Lambda exports each new/updated appointment to S3 as a CSV object and
# hands the GCP side a short-lived presigned URL rather than a standing
# cross-cloud credential. The GCP appointments-mirror Cloud Function
# (infrastructure/gcp/terraform/appointments_mirror.tf) fetches that URL and
# writes the row into Firestore's `appointments` collection, where the chatbot
# reads it for appointment lookups.
#
# This replaces the earlier Workload Identity Federation approach: WIF pool
# creation is blocked by org policy on the GCP project, so the appointments
# mirror now reuses the same keyless S3-presigned pattern already proven by the
# feedback mirror (backend/feedback/export_feedback_csv.py). See
# architectural_decisions.md §4.
#
# Triggered by the saws-appointments DynamoDB Stream (appointments.tf).

_deserializer = TypeDeserializer()
_s3 = boto3.client('s3')

CSV_FIELDS = ['refCode', 'date', 'service', 'status']
PRESIGN_TTL_SECONDS = 600


def _deserialize_image(image):
    return {key: _deserializer.deserialize(value) for key, value in image.items()}


def _to_str(value):
    return '' if value is None else str(value)


def _notify_gcp(appointment_id, csv_url):
    endpoint = os.environ.get('GCP_MIRROR_FUNCTION_URL')
    if not endpoint:
        # Mirror function not deployed/configured yet -- the CSV is still
        # safely in S3, just nothing has told GCP to come get it.
        print('GCP_MIRROR_FUNCTION_URL not set, skipping GCP notify')
        return

    body = json.dumps({'appointmentId': appointment_id, 'csvUrl': csv_url}).encode('utf-8')
    headers = {'Content-Type': 'application/json'}
    secret = os.environ.get('GCP_MIRROR_SHARED_SECRET')
    if secret:
        headers['X-Export-Token'] = secret

    req = urllib.request.Request(endpoint, data=body, headers=headers, method='POST')
    try:
        with urllib.request.urlopen(req, timeout=10) as resp:
            resp.read()
    except (urllib.error.HTTPError, urllib.error.URLError) as e:
        # The export already landed in S3 -- a failed/unreachable GCP notify
        # shouldn't fail the whole stream batch and block later records.
        print(f'GCP mirror notify failed for {appointment_id}: {e}')


def lambda_handler(event, context):
    bucket = os.environ.get('APPOINTMENTS_EXPORT_BUCKET')
    exported = 0

    for record in event.get('Records', []):
        if record.get('eventName') == 'REMOVE':
            continue

        image = record.get('dynamodb', {}).get('NewImage')
        if not image:
            continue

        item = _deserialize_image(image)
        appointment_id = item.get('appointmentId')
        if not appointment_id:
            continue

        if not bucket:
            print('APPOINTMENTS_EXPORT_BUCKET not set, skipping appointments export')
            continue

        row = {
            'refCode': appointment_id,
            'date': item.get('date'),
            'service': item.get('serviceId'),
            'status': item.get('status'),
        }

        buf = io.StringIO()
        writer = csv.DictWriter(buf, fieldnames=CSV_FIELDS)
        writer.writeheader()
        writer.writerow({field: _to_str(row.get(field)) for field in CSV_FIELDS})

        key = f'appointments/{appointment_id}.csv'
        _s3.put_object(Bucket=bucket, Key=key, Body=buf.getvalue().encode('utf-8'), ContentType='text/csv')

        csv_url = _s3.generate_presigned_url(
            'get_object', Params={'Bucket': bucket, 'Key': key}, ExpiresIn=PRESIGN_TTL_SECONDS,
        )
        _notify_gcp(appointment_id, csv_url)
        exported += 1

    return {'exported': exported}
