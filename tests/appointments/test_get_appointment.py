from unittest.mock import patch

import sys
sys.path.insert(0, '../../backend/appointments')
from get_appointment import lambda_handler


def make_event(appointment_id, username='pat@example.com', roles=''):
    claims = {'email': username}
    if roles:
        claims['cognito:groups'] = roles
    return {
        'pathParameters': {'appointmentId': appointment_id},
        'requestContext': {'authorizer': {'jwt': {'claims': claims}}},
    }


@patch('get_appointment.get_appointment_or_none')
def test_owner_can_view_own_appointment(mock_get):
    mock_get.return_value = {'appointmentId': 'A1', 'patientUsername': 'pat@example.com', 'status': 'PENDING'}
    result = lambda_handler(make_event('A1'), None)
    assert result['statusCode'] == 200


@patch('get_appointment.get_appointment_or_none')
def test_other_patient_gets_404(mock_get):
    mock_get.return_value = {'appointmentId': 'A1', 'patientUsername': 'someone-else@example.com', 'status': 'PENDING'}
    result = lambda_handler(make_event('A1'), None)
    assert result['statusCode'] == 404


@patch('get_appointment.get_appointment_or_none')
def test_coordinator_can_view_any_appointment(mock_get):
    mock_get.return_value = {'appointmentId': 'A1', 'patientUsername': 'someone-else@example.com', 'status': 'PENDING'}
    result = lambda_handler(make_event('A1', username='coord@example.com', roles='[Coordinators]'), None)
    assert result['statusCode'] == 200


@patch('get_appointment.get_appointment_or_none')
def test_missing_appointment_returns_404(mock_get):
    mock_get.return_value = None
    result = lambda_handler(make_event('missing'), None)
    assert result['statusCode'] == 404
