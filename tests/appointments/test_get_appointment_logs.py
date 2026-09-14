import json
from unittest.mock import patch

import sys
sys.path.insert(0, '../../backend/appointments')
from get_appointment_logs import lambda_handler


def make_event(appointment_id='A1', roles='[Coordinators]'):
    return {
        'pathParameters': {'appointmentId': appointment_id},
        'requestContext': {'authorizer': {'jwt': {'claims': {'email': 'coord@example.com', 'cognito:groups': roles}}}},
    }


@patch('get_appointment_logs.appointment_logs_table')
def test_coordinator_can_view_logs(mock_table):
    mock_table.query.return_value = {'Items': [{'logId': 'L1', 'action': 'BOOK'}]}
    result = lambda_handler(make_event(), None)
    body = json.loads(result['body'])

    assert result['statusCode'] == 200
    assert body['data'][0]['action'] == 'BOOK'


def test_non_coordinator_gets_403():
    result = lambda_handler(make_event(roles='[Patients]'), None)
    assert result['statusCode'] == 403
