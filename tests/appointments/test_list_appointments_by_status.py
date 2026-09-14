import json
from unittest.mock import patch

import sys
sys.path.insert(0, '../../backend/appointments')
from list_appointments_by_status import lambda_handler


def make_event(status=None, roles='[Coordinators]'):
    return {
        'queryStringParameters': {'status': status} if status else None,
        'requestContext': {'authorizer': {'jwt': {'claims': {'email': 'coord@example.com', 'cognito:groups': roles}}}},
    }


@patch('list_appointments_by_status.appointments_table')
def test_coordinator_lists_by_status(mock_table):
    mock_table.query.return_value = {'Items': [{'appointmentId': 'A1', 'status': 'PENDING'}]}
    result = lambda_handler(make_event(status='pending'), None)
    body = json.loads(result['body'])

    assert result['statusCode'] == 200
    assert body['data'][0]['status'] == 'PENDING'
    mock_table.query.assert_called_once()


def test_non_coordinator_gets_403():
    result = lambda_handler(make_event(status='PENDING', roles='[Patients]'), None)
    assert result['statusCode'] == 403


def test_missing_status_returns_400():
    result = lambda_handler(make_event(status=None), None)
    assert result['statusCode'] == 400
