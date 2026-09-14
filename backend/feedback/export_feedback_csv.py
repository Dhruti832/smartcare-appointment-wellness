import csv
import io
import json
import os
import urllib.error
import urllib.request
from decimal import Decimal

import boto3
from boto3.dynamodb.types import TypeDeserializer

# Cross-cloud feedback mirror, AWS half (Module 5 / analytics). Unlike the
# appointments mirror (backend/appointments/mirror_to_firestore.py), which
# writes to Firestore directly over Workload Identity Federation, GCP has no
# equivalent way to read DynamoDB directly -- so this Lambda exports the
# scored feedback row to S3 as a CSV object and hands the GCP side a
# short-lived presigned URL rather than a standing cross-cloud credential.
# The GCP feedback-mirror Cloud Function (analytics/functions) fetches that
# URL and writes the row into Firestore. See architectural_decisions.md §9.
#
# Triggered by the same saws-feedback DynamoDB Stream as analyze_sentiment.py
# (analytics.tf), but only acts on the MODIFY event that Lambda's own
# UpdateItem produces -- i.e. once a row actually carries a sentimentLabel.
# The initial INSERT (submission, no sentiment yet) is intentionally skipped.

_deserializer = TypeDeserializer()
_s3 = boto3.client('s3')

CSV_FIELDS = [
    'feedbackId', 'patientUsername', 'appointmentId', 'serviceId',
    'feedbackText', 'sentimentScore', 'sentimentMagnitude', 'sentimentLabel',
    'createdAt',
]
PRESIGN_TTL_SECONDS = 600


def _deserialize_image(image):
    return {key: _deserializer.deserialize(value) for key, value in image.items()}


def _to_str(value):
    if value is None:
        return ''
    if isinstance(value, Decimal):
        return str(value)
    return str(value)


def _notify_gcp(feedback_id, csv_url):
    endpoint = os.environ.get('GCP_MIRROR_FUNCTION_URL')
    if not endpoint:
        # Mirror function not deployed/configured yet -- the CSV is still
        # safely in S3, just nothing has told GCP to come get it.
        print('GCP_MIRROR_FUNCTION_URL not set, skipping GCP notify')
        return

    body = json.dumps({'feedbackId': feedback_id, 'csvUrl': csv_url}).encode('utf-8')
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
        print(f'GCP mirror notify failed for {feedback_id}: {e}')


def lambda_handler(event, context):
    bucket = os.environ.get('FEEDBACK_EXPORT_BUCKET')
    exported = 0

    for record in event.get('Records', []):
        if record.get('eventName') != 'MODIFY':
            continue

        image = record.get('dynamodb', {}).get('NewImage')
        if not image:
            continue

        item = _deserialize_image(image)
        if 'sentimentLabel' not in item:
            # Not yet scored by analyze_sentiment.py -- nothing to export.
            continue

        feedback_id = item.get('feedbackId')
        if not feedback_id:
            continue

        if not bucket:
            print('FEEDBACK_EXPORT_BUCKET not set, skipping feedback export')
            continue

        buf = io.StringIO()
        writer = csv.DictWriter(buf, fieldnames=CSV_FIELDS)
        writer.writeheader()
        writer.writerow({field: _to_str(item.get(field)) for field in CSV_FIELDS})

        key = f'feedback/{feedback_id}.csv'
        _s3.put_object(Bucket=bucket, Key=key, Body=buf.getvalue().encode('utf-8'), ContentType='text/csv')

        csv_url = _s3.generate_presigned_url(
            'get_object', Params={'Bucket': bucket, 'Key': key}, ExpiresIn=PRESIGN_TTL_SECONDS,
        )
        _notify_gcp(feedback_id, csv_url)
        exported += 1

    return {'exported': exported}
