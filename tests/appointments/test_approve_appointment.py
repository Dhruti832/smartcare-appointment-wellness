import json
from unittest.mock import patch

import sys
sys.path.insert(0, '../../backend/appointments')
from approve_appointment import lambda_handler


def make_event(appointment_id, username='coord@example.com', roles='[Coordinators]'):
    return {
        'pathParameters': {'appointmentId': appointment_id},
        'requestContext': {'authorizer': {'jwt': {'claims': {'email': username, 'cognito:groups': roles}}}},
    }


@patch('approve_appointment.enqueue_notification')
@patch('approve_appointment.write_log')
@patch('approve_appointment.appointments_table')
@patch('approve_appointment.get_appointment_or_none')
def test_pending_appointment_gets_approved(mock_get, mock_table, mock_write_log, mock_enqueue):
    mock_get.return_value = {'appointmentId': 'A1', 'status': 'PENDING', 'patientUsername': 'pat@example.com'}

    result = lambda_handler(make_event('A1'), None)
    body = json.loads(result['body'])

    assert result['statusCode'] == 200
    assert body['data']['status'] == 'APPROVED'
    mock_table.update_item.assert_called_once()
    mock_enqueue.assert_called_once_with('APPROVE', 'A1', 'pat@example.com')


@patch('approve_appointment.enqueue_notification')
@patch('approve_appointment.write_log')
@patch('approve_appointment.appointments_table')
@patch('approve_appointment.get_appointment_or_none')
def test_non_pending_appointment_rejected_with_400(mock_get, mock_table, mock_write_log, mock_enqueue):
    mock_get.return_value = {'appointmentId': 'A1', 'status': 'CANCELLED', 'patientUsername': 'pat@example.com'}
    result = lambda_handler(make_event('A1'), None)
    assert result['statusCode'] == 400
    mock_table.update_item.assert_not_called()


@patch('approve_appointment.get_appointment_or_none')
def test_non_coordinator_gets_403(mock_get):
    result = lambda_handler(make_event('A1', username='pat@example.com', roles='[Patients]'), None)
    assert result['statusCode'] == 403
    mock_get.assert_not_called()
