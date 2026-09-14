import json
import os
import re
import uuid
from datetime import datetime, timezone

import boto3

dynamodb = boto3.resource('dynamodb')
sqs = boto3.client('sqs')

appointments_table = dynamodb.Table(os.environ.get('APPOINTMENTS_TABLE_NAME', 'saws-appointments-dev'))
appointment_logs_table = dynamodb.Table(os.environ.get('APPOINTMENT_LOGS_TABLE_NAME', 'saws-appointment-logs-dev'))
services_table = dynamodb.Table(os.environ.get('SERVICES_TABLE_NAME', 'saws-services-dev'))
NOTIFICATIONS_QUEUE_URL = os.environ.get('NOTIFICATIONS_QUEUE_URL', '')

COORDINATOR_GROUP = 'Coordinators'
PATIENT_GROUP = 'Patients'

# Cap free-text fields so a request can't push oversized values into DynamoDB
# or logs. Generous for legitimate input, small enough to blunt abuse.
MAX_FIELD_LEN = 256
MAX_TEXT_LEN = 2000
TIME_RE = re.compile(r'^([01]\d|2[0-3]):[0-5]\d$')


class ValidationError(Exception):
    """Raised for any bad client input. Handlers catch this and return 400 so
    malformed input is a clean rejection, never an unhandled 500/stack trace."""

    def __init__(self, message):
        self.message = message
        super().__init__(message)


def parse_json_body(event):
    """Parse the API Gateway proxy body safely. A missing body is an empty
    object; anything that isn't a JSON object is a 400, not a crash."""
    raw = event.get('body')
    if raw is None or raw == '':
        return {}
    try:
        data = json.loads(raw)
    except (ValueError, TypeError):
        raise ValidationError('Request body is not valid JSON')
    if not isinstance(data, dict):
        raise ValidationError('Request body must be a JSON object')
    return data


def require(data, *fields):
    missing = [f for f in fields if not str(data.get(f) or '').strip()]
    if missing:
        raise ValidationError(f'Missing required fields: {", ".join(missing)}')


def validate_length(value, field, max_len=MAX_FIELD_LEN):
    value = str(value or '')
    if len(value) > max_len:
        raise ValidationError(f'{field} exceeds the maximum length of {max_len} characters')
    return value


def validate_date(value, field='date'):
    """Accept an ISO calendar date (YYYY-MM-DD) that is a real date."""
    value = str(value or '').strip()
    try:
        datetime.strptime(value, '%Y-%m-%d')
    except ValueError:
        raise ValidationError(f'{field} must be a valid date in YYYY-MM-DD format')
    return value


def validate_time(value, field='time'):
    """Accept a 24-hour HH:MM time."""
    value = str(value or '').strip()
    if not TIME_RE.match(value):
        raise ValidationError(f'{field} must be a valid time in HH:MM (24-hour) format')
    return value


def validate_choice(value, field, allowed):
    normalized = str(value or '').strip().upper()
    if normalized not in allowed:
        raise ValidationError(f'{field} must be one of: {", ".join(sorted(allowed))}')
    return normalized


def response(status_code, message, data=None):
    body = {'message': message}
    if data is not None:
        body['data'] = data
    return {
        'statusCode': status_code,
        'headers': {'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*'},
        'body': json.dumps(body, default=str),
    }


def get_claims(event):
    return event.get('requestContext', {}).get('authorizer', {}).get('jwt', {}).get('claims', {})


def get_username(event):
    email = get_claims(event).get('email', '')
    return email.strip().lower() or None


def get_roles(event):
    # API Gateway's HTTP API JWT authorizer stringifies array claims as
    # "[a, b]" (brackets kept) rather than a plain comma-joined list --
    # same quirk worked around in backend/auth/get_profile.py.
    groups = get_claims(event).get('cognito:groups', '')
    groups = groups.strip('[]') if isinstance(groups, str) else ''
    return [g.strip() for g in groups.split(',') if g.strip()]


def is_coordinator(event):
    return COORDINATOR_GROUP in get_roles(event)


def is_patient(event):
    return PATIENT_GROUP in get_roles(event)


class AuthorizationError(Exception):
    """Raised when the caller's token is missing (401) or lacks the required
    role (403). Handlers catch this and map it straight to a response, so role
    enforcement is server-side and identical across every protected route."""

    def __init__(self, status, message):
        self.status = status
        self.message = message
        super().__init__(message)


def require_authenticated(event):
    """Return the caller's username, or raise 401 if the verified token carried
    no identity. The JWT authorizer has already checked the signature/expiry;
    this guards against a route wired without it or a token missing `email`."""
    username = get_username(event)
    if not username:
        raise AuthorizationError(401, 'Missing or invalid authorization')
    return username


def require_coordinator(event):
    """Return the caller's username, or raise 403 if they are not a
    Coordinator. This is the server-side role check -- the UI hiding a button
    is never trusted."""
    username = require_authenticated(event)
    if not is_coordinator(event):
        raise AuthorizationError(403, 'Coordinator role required')
    return username


def require_patient(event):
    """Return the caller's username, or raise 403 if they are not a Patient.
    Booking is patient-only; the UI hiding the page from Coordinators is never
    trusted, so the endpoint enforces the role itself."""
    username = require_authenticated(event)
    if not is_patient(event):
        raise AuthorizationError(403, 'Patient role required')
    return username


def now_iso():
    return datetime.now(timezone.utc).isoformat()


def get_path_param(event, name):
    return (event.get('pathParameters') or {}).get(name)


def get_appointment_or_none(appointment_id):
    if not appointment_id:
        return None
    return appointments_table.get_item(Key={'appointmentId': appointment_id}).get('Item')


def get_service_or_none(service_id):
    if not service_id:
        return None
    return services_table.get_item(Key={'serviceId': service_id}).get('Item')


def write_log(appointment_id, action, performed_by, details=''):
    appointment_logs_table.put_item(Item={
        'logId': uuid.uuid4().hex,
        'appointmentId': appointment_id,
        'action': action,
        'performedBy': performed_by,
        'details': details,
        'createdAt': now_iso(),
    })


def enqueue_notification(action, appointment_id, patient_username):
    if not NOTIFICATIONS_QUEUE_URL:
        return
    sqs.send_message(
        QueueUrl=NOTIFICATIONS_QUEUE_URL,
        MessageBody=json.dumps({
            'action': action,
            'appointmentId': appointment_id,
            'patientId': patient_username,
        }),
    )
