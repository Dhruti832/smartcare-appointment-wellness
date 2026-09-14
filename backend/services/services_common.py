import json
import os
import uuid
from decimal import Decimal, InvalidOperation

import boto3

dynamodb = boto3.resource('dynamodb')
services_table = dynamodb.Table(os.environ.get('SERVICES_TABLE_NAME', 'saws-services-dev'))

COORDINATOR_GROUP = 'Coordinators'

# Same caps as appointments_common.py / validation_utils.py -- kept as its own
# copy here since each Lambda bundle is a flat zip of its own source dir.
MAX_FIELD_LEN = 256
MAX_TEXT_LEN = 2000


class ValidationError(Exception):
    """Raised for any bad client input. Handlers catch this and return 400 so
    malformed input is a clean rejection, never an unhandled 500/stack trace."""

    def __init__(self, message):
        self.message = message
        super().__init__(message)


class AuthorizationError(Exception):
    """Raised when the caller's token is missing (401) or lacks the required
    role (403). Handlers catch this and map it straight to a response, so role
    enforcement is server-side and identical across every protected route."""

    def __init__(self, status, message):
        self.status = status
        self.message = message
        super().__init__(message)


def parse_json_body(event):
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


def validate_positive_number(value, field):
    try:
        number = Decimal(str(value))
    except (InvalidOperation, TypeError):
        raise ValidationError(f'{field} must be a number')
    if number <= 0:
        raise ValidationError(f'{field} must be greater than zero')
    return number


def _json_default(value):
    # DynamoDB returns numeric attributes as Decimal, which json can't encode.
    # The API contract (docs/api/api-contract.md §2) types durationMinutes and
    # price as numbers, so emit them as int/float rather than stringifying.
    if isinstance(value, Decimal):
        return int(value) if value == value.to_integral_value() else float(value)
    return str(value)


def response(status_code, message, data=None):
    body = {'message': message}
    if data is not None:
        body['data'] = data
    return {
        'statusCode': status_code,
        'headers': {'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*'},
        'body': json.dumps(body, default=_json_default),
    }


def get_claims(event):
    return event.get('requestContext', {}).get('authorizer', {}).get('jwt', {}).get('claims', {})


def get_username(event):
    email = get_claims(event).get('email', '')
    return email.strip().lower() or None


def get_roles(event):
    # API Gateway's HTTP API JWT authorizer stringifies array claims as
    # "[a, b]" (brackets kept) rather than a plain comma-joined list -- same
    # quirk worked around in backend/appointments/appointments_common.py.
    groups = get_claims(event).get('cognito:groups', '')
    groups = groups.strip('[]') if isinstance(groups, str) else ''
    return [g.strip() for g in groups.split(',') if g.strip()]


def is_coordinator(event):
    return COORDINATOR_GROUP in get_roles(event)


def require_authenticated(event):
    """Return the caller's username, or raise 401 if the verified token
    carried no identity."""
    username = get_username(event)
    if not username:
        raise AuthorizationError(401, 'Missing or invalid authorization')
    return username


def require_coordinator(event):
    """Return the caller's username, or raise 403 if they are not a
    Coordinator. Server-side role enforcement -- the UI hiding the "create
    service" button is never trusted."""
    username = require_authenticated(event)
    if not is_coordinator(event):
        raise AuthorizationError(403, 'Coordinator role required')
    return username


def new_service_id():
    return f'svc-{uuid.uuid4().hex[:8]}'


def get_path_param(event, name):
    return (event.get('pathParameters') or {}).get(name)


def get_service_or_none(service_id):
    if not service_id:
        return None
    return services_table.get_item(Key={'serviceId': service_id}).get('Item')
