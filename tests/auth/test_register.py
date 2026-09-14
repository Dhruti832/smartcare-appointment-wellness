import json
from unittest.mock import patch

import sys
sys.path.insert(0, '../../backend/auth')
from register import lambda_handler


class FakeUsernameExists(Exception):
    pass


def _install_fake_exceptions(mock_cognito):
    mock_cognito.exceptions.UsernameExistsException = FakeUsernameExists


def make_event(body):
    return {'body': json.dumps(body)}


def valid_payload(**overrides):
    payload = {
        'email': 'Patient@Example.com',
        'password': 'Secret123!',
        'role': 'patient',
        'securityQuestion': "What is your pet's name?",
        'securityAnswer': 'Fluffy',
        'healthcareCode': 'hello',
    }
    payload.update(overrides)
    return payload


@patch('register.security_table')
@patch('register.cognito')
def test_successful_registration_creates_security_record(mock_cognito, mock_table):
    _install_fake_exceptions(mock_cognito)

    result = lambda_handler(make_event(valid_payload()), None)
    body = json.loads(result['body'])

    assert result['statusCode'] == 201
    assert body['username'] == 'patient@example.com'
    assert body['role'] == 'PATIENT'

    mock_cognito.admin_add_user_to_group.assert_called_once()
    _, kwargs = mock_cognito.admin_add_user_to_group.call_args
    assert kwargs['GroupName'] == 'Patients'
    assert kwargs['Username'] == 'patient@example.com'

    put_item_kwargs = mock_table.put_item.call_args.kwargs
    item = put_item_kwargs['Item']
    assert item['username'] == 'patient@example.com'
    # Only hashes are stored -- never the raw security answer or healthcare code.
    assert 'securityAnswer' not in item
    assert 'healthcareCode' not in item
    assert item['securityAnswerHash']
    assert item['caesarAnswerHash']
    assert item['caesarClue']
    assert isinstance(item['caesarShift'], int)
    assert 1 <= item['caesarShift'] <= 25


@patch('register.security_table')
@patch('register.cognito')
def test_missing_fields_returns_400(mock_cognito, mock_table):
    result = lambda_handler(make_event({'email': 'a@b.com'}), None)
    assert result['statusCode'] == 400


@patch('register.security_table')
@patch('register.cognito')
def test_invalid_role_returns_400(mock_cognito, mock_table):
    result = lambda_handler(make_event(valid_payload(role='ADMIN')), None)
    assert result['statusCode'] == 400


@patch('register.security_table')
@patch('register.cognito')
def test_duplicate_email_returns_409(mock_cognito, mock_table):
    _install_fake_exceptions(mock_cognito)
    mock_cognito.admin_create_user.side_effect = FakeUsernameExists()

    result = lambda_handler(make_event(valid_payload()), None)
    assert result['statusCode'] == 409