import json
import time
from decimal import Decimal
from unittest.mock import patch

import sys
sys.path.insert(0, '../../backend/auth')
from stage2_security_qa import lambda_handler
from hashing_utils import hash_text


def make_event(body):
    return {'body': json.dumps(body)}


def active_session(**overrides):
    session = {
        'sessionId': 's1',
        'username': 'pat@example.com',
        'stage1Done': True,
        'stage2Done': False,
        'expiresAt': int(time.time()) + 300,
    }
    session.update(overrides)
    return session


def security_record(**overrides):
    # DynamoDB returns numeric attributes as Decimal, not int/float -- use the
    # same type here so a regression like "json.dumps can't serialize Decimal"
    # actually gets caught.
    record = {
        'username': 'pat@example.com',
        'securityAnswerHash': hash_text('fluffy'),
        'caesarClue': 'KHOOR',
        'caesarShift': Decimal('3'),
    }
    record.update(overrides)
    return record


@patch('stage2_security_qa.security_table')
@patch('stage2_security_qa.sessions_table')
def test_correct_answer_passes(mock_sessions_table, mock_security_table):
    mock_sessions_table.get_item.return_value = {'Item': active_session()}
    mock_security_table.get_item.return_value = {'Item': security_record()}

    result = lambda_handler(make_event({'sessionId': 's1', 'answer': 'Fluffy'}), None)
    body = json.loads(result['body'])

    assert result['statusCode'] == 200
    assert body['cipherClue'] == 'KHOOR'
    assert body['caesarShift'] == 3


@patch('stage2_security_qa.security_table')
@patch('stage2_security_qa.sessions_table')
def test_wrong_answer_fails(mock_sessions_table, mock_security_table):
    mock_sessions_table.get_item.return_value = {'Item': active_session()}
    mock_security_table.get_item.return_value = {'Item': security_record()}
    # First wrong try: counter is now 1, well under the lockout threshold.
    mock_sessions_table.update_item.return_value = {'Attributes': {'failedAttempts': 1}}

    result = lambda_handler(make_event({'sessionId': 's1', 'answer': 'wrong'}), None)
    body = json.loads(result['body'])
    assert result['statusCode'] == 401
    assert body['message'] == 'Incorrect security answer'
    mock_sessions_table.delete_item.assert_not_called()


@patch('stage2_security_qa.security_table')
@patch('stage2_security_qa.sessions_table')
def test_too_many_wrong_answers_burns_session(mock_sessions_table, mock_security_table):
    mock_sessions_table.get_item.return_value = {'Item': active_session()}
    mock_security_table.get_item.return_value = {'Item': security_record()}
    # Fifth wrong try hits MAX_FAILED_ATTEMPTS -> session is deleted and the
    # response falls back to the opaque "session gone" message.
    mock_sessions_table.update_item.return_value = {'Attributes': {'failedAttempts': 5}}

    result = lambda_handler(make_event({'sessionId': 's1', 'answer': 'wrong'}), None)
    body = json.loads(result['body'])
    assert result['statusCode'] == 401
    assert body['message'] == 'Invalid or expired login session, please sign in again'
    mock_sessions_table.delete_item.assert_called_once_with(Key={'sessionId': 's1'})


@patch('stage2_security_qa.security_table')
@patch('stage2_security_qa.sessions_table')
def test_missing_fields_returns_400(mock_sessions_table, mock_security_table):
    result = lambda_handler(make_event({'sessionId': 's1'}), None)
    assert result['statusCode'] == 400


@patch('stage2_security_qa.security_table')
@patch('stage2_security_qa.sessions_table')
def test_unknown_session_returns_401(mock_sessions_table, mock_security_table):
    mock_sessions_table.get_item.return_value = {}

    result = lambda_handler(make_event({'sessionId': 'unknown', 'answer': 'x'}), None)
    assert result['statusCode'] == 401


@patch('stage2_security_qa.security_table')
@patch('stage2_security_qa.sessions_table')
def test_expired_session_rejected(mock_sessions_table, mock_security_table):
    mock_sessions_table.get_item.return_value = {'Item': active_session(expiresAt=int(time.time()) - 10)}

    result = lambda_handler(make_event({'sessionId': 's1', 'answer': 'fluffy'}), None)
    assert result['statusCode'] == 401


@patch('stage2_security_qa.security_table')
@patch('stage2_security_qa.sessions_table')
def test_cannot_skip_stage1(mock_sessions_table, mock_security_table):
    mock_sessions_table.get_item.return_value = {'Item': active_session(stage1Done=False)}

    result = lambda_handler(make_event({'sessionId': 's1', 'answer': 'fluffy'}), None)
    assert result['statusCode'] == 401


@patch('stage2_security_qa.security_table')
@patch('stage2_security_qa.sessions_table')
def test_cannot_replay_completed_stage2(mock_sessions_table, mock_security_table):
    mock_sessions_table.get_item.return_value = {'Item': active_session(stage2Done=True)}

    result = lambda_handler(make_event({'sessionId': 's1', 'answer': 'fluffy'}), None)
    assert result['statusCode'] == 401