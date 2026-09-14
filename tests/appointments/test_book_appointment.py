import json
from unittest.mock import patch

import sys
sys.path.insert(0, '../../backend/appointments')
from book_appointment import lambda_handler


def make_event(body, username='pat@example.com', groups='Patients'):
    event = {'body': json.dumps(body)}
    claims = {}
    if username:
        claims['email'] = username
    if groups is not None:
        # HTTP API JWT authorizer stringifies the groups claim as "[a, b]".
        claims['cognito:groups'] = f'[{groups}]'
    event['requestContext'] = {'authorizer': {'jwt': {'claims': claims}}} if claims else {}
    return event


@patch('book_appointment.get_service_or_none', return_value={'serviceId': 'svc-001'})
@patch('book_appointment.enqueue_notification')
@patch('book_appointment.write_log')
@patch('book_appointment.appointments_table')
def test_successful_booking_creates_pending_appointment(mock_table, mock_write_log, mock_enqueue, mock_service):
    # No existing appointment at this slot -- an un-stubbed MagicMock scan()
    # would otherwise look like a conflict and return 409.
    mock_table.scan.return_value = {'Items': []}
    result = lambda_handler(make_event({'serviceId': 'svc-001', 'date': '2026-08-01', 'time': '10:00'}), None)
    body = json.loads(result['body'])

    assert result['statusCode'] == 201
    assert body['data']['status'] == 'PENDING'
    assert 'appointmentId' in body['data']

    mock_table.put_item.assert_called_once()
    item = mock_table.put_item.call_args.kwargs['Item']
    assert item['patientUsername'] == 'pat@example.com'
    assert item['status'] == 'PENDING'

    mock_write_log.assert_called_once()
    mock_enqueue.assert_called_once_with('BOOK', item['appointmentId'], 'pat@example.com')


@patch('book_appointment.get_service_or_none', return_value={'serviceId': 'svc-001'})
@patch('book_appointment.enqueue_notification')
@patch('book_appointment.write_log')
@patch('book_appointment.appointments_table')
def test_double_booking_same_slot_returns_409(mock_table, mock_write_log, mock_enqueue, mock_service):
    mock_table.scan.return_value = {'Items': [{'appointmentId': 'EXISTING'}]}
    result = lambda_handler(make_event({'serviceId': 'svc-001', 'date': '2026-08-01', 'time': '10:00'}), None)

    assert result['statusCode'] == 409
    mock_table.put_item.assert_not_called()
    mock_enqueue.assert_not_called()


@patch('book_appointment.get_service_or_none', return_value={'serviceId': 'svc-001'})
@patch('book_appointment.enqueue_notification')
@patch('book_appointment.write_log')
@patch('book_appointment.appointments_table')
def test_missing_fields_returns_400(mock_table, mock_write_log, mock_enqueue, mock_service):
    result = lambda_handler(make_event({'serviceId': 'svc-001'}), None)
    assert result['statusCode'] == 400
    mock_table.put_item.assert_not_called()


@patch('book_appointment.get_service_or_none', return_value={'serviceId': 'svc-001'})
@patch('book_appointment.enqueue_notification')
@patch('book_appointment.write_log')
@patch('book_appointment.appointments_table')
def test_missing_auth_returns_401(mock_table, mock_write_log, mock_enqueue, mock_service):
    result = lambda_handler(make_event({'serviceId': 'svc-001', 'date': '2026-08-01', 'time': '10:00'}, username=None, groups=None), None)
    assert result['statusCode'] == 401
    mock_table.put_item.assert_not_called()


@patch('book_appointment.get_service_or_none', return_value={'serviceId': 'svc-001'})
@patch('book_appointment.enqueue_notification')
@patch('book_appointment.write_log')
@patch('book_appointment.appointments_table')
def test_coordinator_cannot_book_returns_403(mock_table, mock_write_log, mock_enqueue, mock_service):
    result = lambda_handler(make_event({'serviceId': 'svc-001', 'date': '2026-08-01', 'time': '10:00'}, groups='Coordinators'), None)
    assert result['statusCode'] == 403
    mock_table.put_item.assert_not_called()


@patch('book_appointment.get_service_or_none', return_value=None)
@patch('book_appointment.enqueue_notification')
@patch('book_appointment.write_log')
@patch('book_appointment.appointments_table')
def test_nonexistent_service_returns_400(mock_table, mock_write_log, mock_enqueue, mock_service):
    result = lambda_handler(make_event({'serviceId': 'svc-nope', 'date': '2026-08-01', 'time': '10:00'}), None)
    assert result['statusCode'] == 400
    mock_table.put_item.assert_not_called()
