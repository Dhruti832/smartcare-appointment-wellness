import base64
import json
import time
from unittest.mock import patch

import sys
sys.path.insert(0, '../../backend/auth')
from stage3_caesar_cipher import lambda_handler
from hashing_utils import hash_text


def make_event(body):
    return {'body': json.dumps(body)}


def _fake_id_token(groups):
    payload = base64.urlsafe_b64encode(json.dumps({'cognito:groups': groups}).encode()).decode().rstrip('=')
    return f'header.{payload}.signature'


def active_session(**overrides):
    session = {
        'sessionId': 's1',
        'username': 'pat@example.com',
        'stage1Done': True,
        'stage2Done': True,
        'stage3Done': False,
        'expiresAt': int(time.time()) + 300,
        'pendingTokens': {
            'idToken': _fake_id_token(['Patients']),
            'accessToken': 'acc',
            'refreshToken': 'ref',
        },
    }
    session.update(overrides)
    return session


def security_record(**overrides):
    record = {'username': 'pat@example.com', 'caesarAnswerHash': hash_text('HELLO')}
    record.update(overrides)
    return record


@patch('stage3_caesar_cipher.security_table')
@patch('stage3_caesar_cipher.sessions_table')
def test_correct_answer_passes(mock_sessions_table, mock_security_table):
    mock_sessions_table.get_item.return_value = {'Item': active_session()}
    mock_security_table.get_item.return_value = {'Item': security_record()}

    result = lambda_handler(make_event({'sessionId': 's1', 'cipherAnswer': 'hello'}), None)
    body = json.loads(result['body'])

    assert result['statusCode'] == 200
    assert body['role'] == 'Patients'
    assert body['idToken']
    mock_sessions_table.delete_item.assert_called_once_with(Key={'sessionId': 's1'})


@patch('stage3_caesar_cipher.security_table')
@patch('stage3_caesar_cipher.sessions_table')
def test_wrong_answer_fails(mock_sessions_table, mock_security_table):
    mock_sessions_table.get_item.return_value = {'Item': active_session()}
    mock_security_table.get_item.return_value = {'Item': security_record()}
    mock_sessions_table.update_item.return_value = {'Attributes': {'failedAttempts': 1}}

    result = lambda_handler(make_event({'sessionId': 's1', 'cipherAnswer': 'WRONG'}), None)
    body = json.loads(result['body'])
    assert result['statusCode'] == 401
    assert body['message'] == 'Invalid cipher code'
    mock_sessions_table.delete_item.assert_not_called()


@patch('stage3_caesar_cipher.security_table')
@patch('stage3_caesar_cipher.sessions_table')
def test_too_many_wrong_answers_burns_session(mock_sessions_table, mock_security_table):
    mock_sessions_table.get_item.return_value = {'Item': active_session()}
    mock_security_table.get_item.return_value = {'Item': security_record()}
    mock_sessions_table.update_item.return_value = {'Attributes': {'failedAttempts': 5}}

    result = lambda_handler(make_event({'sessionId': 's1', 'cipherAnswer': 'WRONG'}), None)
    body = json.loads(result['body'])
    assert result['statusCode'] == 401
    assert body['message'] == 'Invalid or expired login session, please sign in again'
    mock_sessions_table.delete_item.assert_called_once_with(Key={'sessionId': 's1'})


@patch('stage3_caesar_cipher.security_table')
@patch('stage3_caesar_cipher.sessions_table')
def test_cannot_skip_stage2(mock_sessions_table, mock_security_table):
    mock_sessions_table.get_item.return_value = {'Item': active_session(stage2Done=False)}

    result = lambda_handler(make_event({'sessionId': 's1', 'cipherAnswer': 'hello'}), None)
    assert result['statusCode'] == 401


@patch('stage3_caesar_cipher.security_table')
@patch('stage3_caesar_cipher.sessions_table')
def test_cannot_replay_completed_stage3(mock_sessions_table, mock_security_table):
    mock_sessions_table.get_item.return_value = {'Item': active_session(stage3Done=True)}

    result = lambda_handler(make_event({'sessionId': 's1', 'cipherAnswer': 'hello'}), None)
    assert result['statusCode'] == 401