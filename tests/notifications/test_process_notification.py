import json
from unittest.mock import patch

import sys
sys.path.insert(0, '../../backend/notifications')
from process_notification import lambda_handler


def make_event(*bodies):
    return {'Records': [{'body': json.dumps(body)} for body in bodies]}


@patch('process_notification.appointments_table')
@patch('process_notification.sns')
def test_book_looks_up_appointment_and_publishes(mock_sns, mock_table):
    mock_table.get_item.return_value = {
        'Item': {'date': '2026-07-15', 'time': '10:00'}
    }

    result = lambda_handler(make_event(
        {'action': 'BOOK', 'appointmentId': 'A-1', 'patientId': 'p1'}
    ), None)

    assert result['statusCode'] == 200
    mock_table.get_item.assert_called_once_with(Key={'appointmentId': 'A-1'})
    kwargs = mock_sns.publish.call_args.kwargs
    assert 'A-1' in kwargs['Message']
    assert '2026-07-15' in kwargs['Message']
    assert '10:00' in kwargs['Message']
    assert kwargs['MessageAttributes']['patientId']['StringValue'] == 'p1'


# The coordinator decision handlers have always enqueued APPROVE/REJECT, but
# until Sprint 3 neither had a template, so both were silently dropped as
# unknown actions and no decision email ever reached the patient.
@patch('process_notification.appointments_table')
@patch('process_notification.sns')
def test_approve_publishes_decision_with_appointment_details(mock_sns, mock_table):
    mock_table.get_item.return_value = {
        'Item': {'date': '2026-08-01', 'time': '14:30'}
    }

    result = lambda_handler(make_event(
        {'action': 'APPROVE', 'appointmentId': 'A-2', 'patientId': 'p1'}
    ), None)

    assert result['statusCode'] == 200
    mock_table.get_item.assert_called_once_with(Key={'appointmentId': 'A-2'})
    kwargs = mock_sns.publish.call_args.kwargs
    assert 'approved' in kwargs['Message']
    assert 'A-2' in kwargs['Message']
    assert '2026-08-01' in kwargs['Message']
    assert '14:30' in kwargs['Message']
    assert kwargs['Subject'] == 'SAWS - Approve Notification'


@patch('process_notification.appointments_table')
@patch('process_notification.sns')
def test_reject_publishes_decision_with_appointment_details(mock_sns, mock_table):
    mock_table.get_item.return_value = {
        'Item': {'date': '2026-08-02', 'time': '09:00'}
    }

    lambda_handler(make_event(
        {'action': 'REJECT', 'appointmentId': 'A-3', 'patientId': 'p1'}
    ), None)

    kwargs = mock_sns.publish.call_args.kwargs
    assert 'could not be approved' in kwargs['Message']
    assert 'A-3' in kwargs['Message']
    assert '2026-08-02' in kwargs['Message']


@patch('process_notification.appointments_table')
@patch('process_notification.sns')
def test_cancel_publishes_cancellation(mock_sns, mock_table):
    mock_table.get_item.return_value = {'Item': {'date': '2026-08-03', 'time': '11:15'}}

    lambda_handler(make_event(
        {'action': 'CANCEL', 'appointmentId': 'A-4', 'patientId': 'p1'}
    ), None)

    kwargs = mock_sns.publish.call_args.kwargs
    assert 'cancelled' in kwargs['Message']
    assert 'A-4' in kwargs['Message']


@patch('process_notification.appointments_table')
@patch('process_notification.sns')
def test_login_publishes_without_appointment_lookup(mock_sns, mock_table):
    lambda_handler(make_event({'action': 'LOGIN', 'patientId': 'p2'}), None)

    mock_table.get_item.assert_not_called()
    kwargs = mock_sns.publish.call_args.kwargs
    assert 'successfully logged in' in kwargs['Message']


@patch('process_notification.appointments_table')
@patch('process_notification.sns')
def test_register_publishes_welcome_message(mock_sns, mock_table):
    lambda_handler(make_event({'action': 'REGISTER', 'patientId': 'p3'}), None)

    kwargs = mock_sns.publish.call_args.kwargs
    assert 'Welcome to SAWS' in kwargs['Message']
    assert kwargs['Subject'] == 'SAWS - Register Notification'


@patch('process_notification.appointments_table')
@patch('process_notification.sns')
def test_unknown_action_is_skipped_without_crash(mock_sns, mock_table):
    result = lambda_handler(make_event({'action': 'DANCE', 'patientId': 'p4'}), None)

    assert result['statusCode'] == 200
    mock_sns.publish.assert_not_called()


@patch('process_notification.appointments_table')
@patch('process_notification.sns')
def test_missing_action_is_skipped_without_crash(mock_sns, mock_table):
    result = lambda_handler(make_event({'patientId': 'p5'}), None)

    assert result['statusCode'] == 200
    mock_sns.publish.assert_not_called()


@patch('process_notification.appointments_table')
@patch('process_notification.sns')
def test_reminder_without_appointment_id_still_publishes(mock_sns, mock_table):
    # send_reminders always supplies an appointmentId, but a REMINDER fired by
    # hand from the console (demo fallback) has none and must not crash.
    lambda_handler(make_event({'action': 'REMINDER', 'patientId': 'scheduled-reminder'}), None)

    mock_table.get_item.assert_not_called()
    kwargs = mock_sns.publish.call_args.kwargs
    assert 'Reminder' in kwargs['Message']
    assert 'N/A' in kwargs['Message']


@patch('process_notification.appointments_table')
@patch('process_notification.sns')
def test_multiple_records_all_processed(mock_sns, mock_table):
    lambda_handler(make_event(
        {'action': 'REGISTER', 'patientId': 'p6'},
        {'action': 'LOGIN', 'patientId': 'p6'},
    ), None)

    assert mock_sns.publish.call_count == 2
