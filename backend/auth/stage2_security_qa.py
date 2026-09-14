import json
import os
import boto3

from auth_sessions import (
    MAX_FAILED_ATTEMPTS,
    delete_session,
    get_active_session,
    mark_stage2_done,
    register_failed_attempt,
)
from hashing_utils import hash_text
from validation_utils import ValidationError, parse_json_body, require, validate_length

dynamodb = boto3.resource('dynamodb')
security_table = dynamodb.Table(os.environ.get('USER_SECURITY_TABLE_NAME', 'UserSecurity'))
sessions_table = dynamodb.Table(os.environ.get('AUTH_SESSIONS_TABLE_NAME', 'AuthSessions'))

# Deliberately identical for a bad/expired/locked session so the response never
# reveals which one it was, and so the frontend's existing "session gone,
# restart" handling covers the lockout case with no change.
_SESSION_GONE = {'message': 'Invalid or expired login session, please sign in again'}


def lambda_handler(event, context):
    try:
        body = parse_json_body(event)
        require(body, 'sessionId', 'answer')
        session_id = validate_length(body['sessionId'], 'sessionId')
        answer = validate_length(body['answer'], 'answer')
    except ValidationError as exc:
        return _response(400, {'message': exc.message})

    session = get_active_session(sessions_table, session_id)
    if not session or not session.get('stage1Done') or session.get('stage2Done'):
        return _response(401, _SESSION_GONE)

    security = security_table.get_item(Key={'username': session['username']}).get('Item')
    if not security:
        return _response(404, {'message': 'User profile not found'})

    if hash_text(answer.strip().lower()) != security.get('securityAnswerHash'):
        if register_failed_attempt(sessions_table, session_id) >= MAX_FAILED_ATTEMPTS:
            delete_session(sessions_table, session_id)
            return _response(401, _SESSION_GONE)
        return _response(401, {'message': 'Incorrect security answer'})

    mark_stage2_done(sessions_table, session_id)

    return _response(200, {
        'message': 'Stage 2 passed',
        'cipherClue': security.get('caesarClue'),
        # DynamoDB returns numeric attributes as Decimal, which json.dumps rejects.
        'caesarShift': int(security.get('caesarShift', 0)),
    })


def _response(status_code, body):
    return {
        'statusCode': status_code,
        'headers': {'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*'},
        'body': json.dumps(body),
    }