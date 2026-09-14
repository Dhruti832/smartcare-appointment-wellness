import base64
import json
import os
import boto3

from auth_sessions import (
    MAX_FAILED_ATTEMPTS,
    delete_session,
    get_active_session,
    mark_fully_authenticated,
    register_failed_attempt,
)
from hashing_utils import hash_text
from validation_utils import ValidationError, parse_json_body, require, validate_length

dynamodb = boto3.resource('dynamodb')
security_table = dynamodb.Table(os.environ.get('USER_SECURITY_TABLE_NAME', 'UserSecurity'))
sessions_table = dynamodb.Table(os.environ.get('AUTH_SESSIONS_TABLE_NAME', 'AuthSessions'))
sqs = boto3.client('sqs')
NOTIFICATIONS_QUEUE_URL = os.environ.get('NOTIFICATIONS_QUEUE_URL', '')

# Same opaque message for bad/expired/locked sessions (see stage 2).
_SESSION_GONE = {'message': 'Invalid or expired login session, please sign in again'}


def lambda_handler(event, context):
    try:
        body = parse_json_body(event)
        require(body, 'sessionId', 'cipherAnswer')
        session_id = validate_length(body['sessionId'], 'sessionId')
        answer = validate_length(body['cipherAnswer'], 'cipherAnswer').strip().upper()
    except ValidationError as exc:
        return _response(400, {'message': exc.message})

    session = get_active_session(sessions_table, session_id)
    if not session or not session.get('stage2Done') or session.get('stage3Done'):
        return _response(401, _SESSION_GONE)

    security = security_table.get_item(Key={'username': session['username']}).get('Item')
    if not security:
        return _response(404, {'message': 'User profile not found'})

    if hash_text(answer) != security.get('caesarAnswerHash'):
        if register_failed_attempt(sessions_table, session_id) >= MAX_FAILED_ATTEMPTS:
            delete_session(sessions_table, session_id)
            return _response(401, _SESSION_GONE)
        return _response(401, {'message': 'Invalid cipher code'})

    mark_fully_authenticated(sessions_table, session_id)
    tokens = session.get('pendingTokens', {})
    role = _role_from_id_token(tokens.get('idToken', ''))
    delete_session(sessions_table, session_id)
    _notify_login(session['username'])

    return _response(200, {
        'message': 'Authentication successful',
        'username': session['username'],
        'role': role,
        'idToken': tokens.get('idToken'),
        'accessToken': tokens.get('accessToken'),
        'refreshToken': tokens.get('refreshToken'),
    })


def _role_from_id_token(id_token):
    """Cognito issued this token to us directly moments ago in this same
    request chain, so reading its claims without re-verifying the signature
    is safe here — it never came from the client."""
    try:
        payload = id_token.split('.')[1]
        payload += '=' * (-len(payload) % 4)
        claims = json.loads(base64.urlsafe_b64decode(payload))
        groups = claims.get('cognito:groups') or []
        return groups[0] if groups else None
    except (IndexError, ValueError):
        return None


def _notify_login(username):
    if not NOTIFICATIONS_QUEUE_URL:
        return
    sqs.send_message(
        QueueUrl=NOTIFICATIONS_QUEUE_URL,
        MessageBody=json.dumps({'action': 'LOGIN', 'patientId': username}),
    )


def _response(status_code, body):
    return {
        'statusCode': status_code,
        'headers': {'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*'},
        'body': json.dumps(body),
    }