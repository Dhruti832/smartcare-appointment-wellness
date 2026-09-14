import json
from unittest.mock import patch

import sys
sys.path.insert(0, '../../backend/appointments')
from cancel_appointment import lambda_handler


def make_event(appointment_id, username='pat@example.com'):
    return {
        'pathParameters': {'appointmentId': appointment_id},
        'requestContext': {'authorizer': {'jwt': {'claims': {'email': username}}}},
    }


@patch('cancel_appointment.enqueue_notification')
@patch('cancel_appointment.write_log')
@patch('cancel_appointment.appointments_table')
@patch('cancel_appointment.get_appointment_or_none')
def test_owner_can_cancel_pending_appointment(mock_get, mock_table, mock_write_log, mock_enqueue):
    mock_get.return_value = {'appointmentId': 'A1', 'status': 'PENDING', 'patientUsername': 'pat@example.com'}
    result = lambda_handler(make_event('A1'), None)
    body = json.loads(result['body'])

    assert result['statusCode'] == 200
    assert body['data']['status'] == 'CANCELLED'
    mock_enqueue.assert_called_once_with('CANCEL', 'A1', 'pat@example.com')


@patch('cancel_appointment.appointments_table')
@patch('cancel_appointment.get_appointment_or_none')
def test_non_owner_gets_404(mock_get, mock_table):
    mock_get.return_value = {'appointmentId': 'A1', 'status': 'PENDING', 'patientUsername': 'someone-else@example.com'}
    result = lambda_handler(make_event('A1'), None)
    assert result['statusCode'] == 404
    mock_table.update_item.assert_not_called()


@patch('cancel_appointment.appointments_table')
@patch('cancel_appointment.get_appointment_or_none')
def test_completed_appointment_cannot_be_cancelled(mock_get, mock_table):
    mock_get.return_value = {'appointmentId': 'A1', 'status': 'COMPLETED', 'patientUsername': 'pat@example.com'}
    result = lambda_handler(make_event('A1'), None)
    assert result['statusCode'] == 400
    mock_table.update_item.assert_not_called()
