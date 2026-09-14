import json
import os
import uuid
from datetime import datetime, timezone
from decimal import Decimal

import boto3

dynamodb = boto3.resource('dynamodb')
feedback_table = dynamodb.Table(os.environ.get('FEEDBACK_TABLE_NAME', 'saws-feedback-dev'))

# Same caps as the other modules' *_common.py -- kept as its own copy here
# since each Lambda bundle is a flat zip of its own source dir.
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
    role (403). Handlers catch this and map it straight to a response."""

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


def _json_default(value):
    # DynamoDB returns numeric attributes (sentimentScore/magnitude) as Decimal,
    # which json can't encode. Emit them as int/float per the API contract.
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


def require_authenticated(event):
    """Return the caller's username, or raise 401 if the verified token carried
    no identity. The JWT authorizer has already checked signature/expiry."""
    username = get_username(event)
    if not username:
        raise AuthorizationError(401, 'Missing or invalid authorization')
    return username


def new_feedback_id():
    return f'fb-{uuid.uuid4().hex[:8]}'


def now_iso():
    return datetime.now(timezone.utc).isoformat()
