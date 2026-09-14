import time
import uuid

SESSION_TTL_SECONDS = 300  # a stage must be completed within 5 minutes of the previous one
MAX_FAILED_ATTEMPTS = 5    # wrong security-answer/cipher tries before the session is burned


def create_session(table, username, pending_tokens):
    session_id = uuid.uuid4().hex
    table.put_item(Item={
        'sessionId': session_id,
        'username': username,
        'stage1Done': True,
        'stage2Done': False,
        'stage3Done': False,
        'fullyAuthenticated': False,
        'expiresAt': int(time.time()) + SESSION_TTL_SECONDS,
        'pendingTokens': pending_tokens,
    })
    return session_id


def get_active_session(table, session_id):
    session = table.get_item(Key={'sessionId': session_id}).get('Item')
    if not session or int(time.time()) > int(session.get('expiresAt', 0)):
        return None
    return session


def mark_stage2_done(table, session_id):
    table.update_item(
        Key={'sessionId': session_id},
        UpdateExpression='SET stage2Done = :t, expiresAt = :e',
        ExpressionAttributeValues={':t': True, ':e': int(time.time()) + SESSION_TTL_SECONDS},
    )


def mark_fully_authenticated(table, session_id):
    table.update_item(
        Key={'sessionId': session_id},
        UpdateExpression='SET stage3Done = :t, fullyAuthenticated = :t',
        ExpressionAttributeValues={':t': True},
    )


def register_failed_attempt(table, session_id):
    """Increment a session's failed-attempt counter and return the new total.
    Counts wrong security answers (stage 2) and wrong cipher codes (stage 3)
    against one shared budget. When the return value reaches
    MAX_FAILED_ATTEMPTS the caller must invalidate the session so a brute-force
    run can't keep guessing within the 5-minute window."""
    result = table.update_item(
        Key={'sessionId': session_id},
        UpdateExpression='SET failedAttempts = if_not_exists(failedAttempts, :zero) + :one',
        ExpressionAttributeValues={':zero': 0, ':one': 1},
        ReturnValues='UPDATED_NEW',
    )
    return int(result['Attributes']['failedAttempts'])


def delete_session(table, session_id):
    table.delete_item(Key={'sessionId': session_id})