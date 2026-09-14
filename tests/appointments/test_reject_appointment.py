import json
from unittest.mock import patch

import sys
sys.path.insert(0, '../../backend/appointments')
from reject_appointment import lambda_handler


def make_event(appointment_id, body=None, username='coord@example.com', roles='[Coordinators]'):
    return {
        'pathParameters': {'appointmentId': appointment_id},
        'body': json.dumps(body or {}),
        'requestContext': {'authorizer': {'jwt': {'claims': {'email': username, 'cognito:groups': roles}}}},
    }


@patch('reject_appointment.enqueue_notification')
@patch('reject_appointment.write_log')
@patch('reject_appointment.appointments_table')
@patch('reject_appointment.get_appointment_or_none')
def test_pending_appointment_gets_rejected(mock_get, mock_table, mock_write_log, mock_enqueue):
    mock_get.return_value = {'appointmentId': 'A1', 'status': 'PENDING', 'patientUsername': 'pat@example.com'}

    result = lambda_handler(make_event('A1', {'rejectionReason': 'Slot unavailable'}), None)
    body = json.loads(result['body'])

    assert result['statusCode'] == 200
    assert body['data']['status'] == 'REJECTED'
    mock_enqueue.assert_called_once_with('REJECT', 'A1', 'pat@example.com')


@patch('reject_appointment.get_appointment_or_none')
def test_missing_reason_returns_400(mock_get):
    result = lambda_handler(make_event('A1', {}), None)
    assert result['statusCode'] == 400
    mock_get.assert_not_called()


@patch('reject_appointment.enqueue_notification')
@patch('reject_appointment.write_log')
@patch('reject_appointment.appointments_table')
@patch('reject_appointment.get_appointment_or_none')
def test_non_pending_appointment_rejected_with_400(mock_get, mock_table, mock_write_log, mock_enqueue):
    mock_get.return_value = {'appointmentId': 'A1', 'status': 'APPROVED', 'patientUsername': 'pat@example.com'}
    result = lambda_handler(make_event('A1', {'rejectionReason': 'Changed my mind'}), None)
    assert result['statusCode'] == 400
    mock_table.update_item.assert_not_called()


@patch('reject_appointment.get_appointment_or_none')
def test_non_coordinator_gets_403(mock_get):
    result = lambda_handler(
        make_event('A1', {'rejectionReason': 'x'}, username='pat@example.com', roles='[Patients]'), None
    )
    assert result['statusCode'] == 403
    mock_get.assert_not_called()
