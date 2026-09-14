import json
import re

# Shared input-validation helpers for the auth Lambdas. Kept in this module
# (rather than a shared Lambda layer) because each Lambda bundle is a flat zip
# of its own source dir -- backend/appointments carries its own copy of the
# equivalent helpers in appointments_common.py.

EMAIL_RE = re.compile(r'^[^@\s]+@[^@\s]+\.[^@\s]+$')

# Cap free-text fields so a request can't push oversized values into DynamoDB
# or logs. Generous enough for legitimate input, small enough to blunt abuse.
MAX_FIELD_LEN = 256
MAX_TEXT_LEN = 2000


class ValidationError(Exception):
    """Raised for any bad client input. Handlers catch this and return 400 so
    malformed input is a clean rejection, never an unhandled 500/stack trace."""

    def __init__(self, message):
        self.message = message
        super().__init__(message)


def parse_json_body(event):
    """Parse the API Gateway proxy body safely. A missing body is treated as
    an empty object; anything that isn't a JSON object is a 400, not a crash."""
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
    """Ensure every named field is present and non-blank."""
    missing = [f for f in fields if not str(data.get(f) or '').strip()]
    if missing:
        raise ValidationError(f'Missing required fields: {", ".join(missing)}')


def validate_email(value, field='email'):
    value = str(value or '').strip().lower()
    if len(value) > MAX_FIELD_LEN or not EMAIL_RE.match(value):
        raise ValidationError(f'{field} must be a valid email address')
    return value


def validate_length(value, field, max_len=MAX_FIELD_LEN):
    value = str(value or '')
    if len(value) > max_len:
        raise ValidationError(f'{field} exceeds the maximum length of {max_len} characters')
    return value


def validate_choice(value, field, allowed):
    normalized = str(value or '').strip().upper()
    if normalized not in allowed:
        raise ValidationError(f'{field} must be one of: {", ".join(sorted(allowed))}')
    return normalized
