import json
from unittest.mock import patch

import sys
sys.path.insert(0, '../../backend/appointments')
from get_my_appointments import lambda_handler


def make_event(username='pat@example.com'):
    event = {}
    event['requestContext'] = {'authorizer': {'jwt': {'claims': {'email': username}}}} if username else {}
    return event


@patch('get_my_appointments.appointments_table')
def test_returns_patients_appointments(mock_table):
    mock_table.query.return_value = {'Items': [{'appointmentId': 'A1'}]}
    result = lambda_handler(make_event(), None)
    body = json.loads(result['body'])

    assert result['statusCode'] == 200
    assert body['data'] == [{'appointmentId': 'A1'}]
    mock_table.query.assert_called_once_with(
        IndexName='patientUsername-index',
        KeyConditionExpression='patientUsername = :u',
        ExpressionAttributeValues={':u': 'pat@example.com'},
    )


def test_missing_auth_returns_401():
    result = lambda_handler(make_event(username=None), None)
    assert result['statusCode'] == 401
