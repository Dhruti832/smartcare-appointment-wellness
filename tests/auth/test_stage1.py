import json
from unittest.mock import patch

import sys
sys.path.insert(0, '../../backend/auth')
from stage1_cognito_login import lambda_handler


class FakeNotAuthorized(Exception):
    pass


class FakeUserNotFound(Exception):
    pass


def _install_fake_exceptions(mock_cognito):
    mock_cognito.exceptions.NotAuthorizedException = FakeNotAuthorized
    mock_cognito.exceptions.UserNotFoundException = FakeUserNotFound


def make_event(body):
    return {'body': json.dumps(body)}


@patch('stage1_cognito_login.sessions_table')
@patch('stage1_cognito_login.security_table')
@patch('stage1_cognito_login.cognito')
def test_successful_login_opens_session(mock_cognito, mock_security_table, mock_sessions_table):
    _install_fake_exceptions(mock_cognito)
    mock_cognito.admin_initiate_auth.return_value = {
        'AuthenticationResult': {'AccessToken': 'access', 'IdToken': 'id', 'RefreshToken': 'refresh'}
    }
    mock_security_table.get_item.return_value = {'Item': {'username': 'pat@example.com', 'securityQuestion': "What is your pet's name?"}}

    result = lambda_handler(make_event({'username': 'pat@example.com', 'password': 'Secret123!'}), None)
    body = json.loads(result['body'])

    assert result['statusCode'] == 200
    assert 'sessionId' in body
    assert body['securityQuestion'] == "What is your pet's name?"
    mock_sessions_table.put_item.assert_called_once()
    session_item = mock_sessions_table.put_item.call_args.kwargs['Item']
    assert session_item['username'] == 'pat@example.com'
    assert session_item['stage1Done'] is True
    assert session_item['stage2Done'] is False
    assert session_item['pendingTokens']['idToken'] == 'id'


@patch('stage1_cognito_login.sessions_table')
@patch('stage1_cognito_login.security_table')
@patch('stage1_cognito_login.cognito')
def test_wrong_password_returns_401(mock_cognito, mock_security_table, mock_sessions_table):
    _install_fake_exceptions(mock_cognito)
    mock_cognito.admin_initiate_auth.side_effect = FakeNotAuthorized()

    result = lambda_handler(make_event({'username': 'pat@example.com', 'password': 'wrong'}), None)
    assert result['statusCode'] == 401


@patch('stage1_cognito_login.sessions_table')
@patch('stage1_cognito_login.security_table')
@patch('stage1_cognito_login.cognito')
def test_missing_fields_returns_400(mock_cognito, mock_security_table, mock_sessions_table):
    result = lambda_handler(make_event({'username': 'pat@example.com'}), None)
    assert result['statusCode'] == 400


@patch('stage1_cognito_login.sessions_table')
@patch('stage1_cognito_login.security_table')
@patch('stage1_cognito_login.cognito')
def test_missing_security_record_returns_404(mock_cognito, mock_security_table, mock_sessions_table):
    _install_fake_exceptions(mock_cognito)
    mock_cognito.admin_initiate_auth.return_value = {
        'AuthenticationResult': {'AccessToken': 'a', 'IdToken': 'i', 'RefreshToken': 'r'}
    }
    mock_security_table.get_item.return_value = {}

    result = lambda_handler(make_event({'username': 'ghost@example.com', 'password': 'Secret123!'}), None)
    assert result['statusCode'] == 404