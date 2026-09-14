import json
from datetime import datetime, timedelta, timezone
from unittest.mock import patch

import sys
sys.path.insert(0, '../../backend/notifications')
import send_reminders
from send_reminders import lambda_handler


def tomorrow():
    return (datetime.now(timezone.utc) + timedelta(days=1)).strftime('%Y-%m-%d')


def appointment(appointment_id, status='APPROVED'):
    return {
        'appointmentId': appointment_id,
        'patientUsername': 'patient1',
        'status': status,
        'date': tomorrow(),
        'time': '10:00',
    }


def queued_bodies(mock_sqs):
    return [json.loads(c.kwargs['MessageBody']) for c in mock_sqs.send_message.call_args_list]


@patch.object(send_reminders, 'NOTIFICATIONS_QUEUE_URL', 'https://sqs.test/queue')
@patch('send_reminders.appointments_table')
@patch('send_reminders.sqs')
def test_enqueues_one_reminder_per_appointment_due_tomorrow(mock_sqs, mock_table):
    # One PENDING and one APPROVED appointment tomorrow: the GSI is queried once
    # per remindable status, so each query returns its own row.
    mock_table.query.side_effect = [
        {'Items': [appointment('A-1', 'PENDING')]},
        {'Items': [appointment('A-2', 'APPROVED')]},
    ]

    result = lambda_handler({}, None)

    assert result['statusCode'] == 200
    assert result['reminders'] == 2
    assert result['date'] == tomorrow()

    bodies = queued_bodies(mock_sqs)
    assert [b['appointmentId'] for b in bodies] == ['A-1', 'A-2']
    assert all(b['action'] == 'REMINDER' for b in bodies)
    # process_notification reads patientId off the message for the SNS attribute.
    assert all(b['patientId'] == 'patient1' for b in bodies)


@patch.object(send_reminders, 'NOTIFICATIONS_QUEUE_URL', 'https://sqs.test/queue')
@patch('send_reminders.appointments_table')
@patch('send_reminders.sqs')
def test_queries_only_remindable_statuses_for_the_target_date(mock_sqs, mock_table):
    mock_table.query.return_value = {'Items': []}

    lambda_handler({}, None)

    assert mock_table.query.call_count == 2
    for call in mock_table.query.call_args_list:
        assert call.kwargs['IndexName'] == 'status-date-index'
    # CANCELLED/REJECTED appointments must never be reminded about.
    queried = str(mock_table.query.call_args_list)
    assert 'CANCELLED' not in queried
    assert 'REJECTED' not in queried


@patch.object(send_reminders, 'NOTIFICATIONS_QUEUE_URL', 'https://sqs.test/queue')
@patch('send_reminders.appointments_table')
@patch('send_reminders.sqs')
def test_nothing_booked_tomorrow_sends_nothing(mock_sqs, mock_table):
    mock_table.query.return_value = {'Items': []}

    result = lambda_handler({}, None)

    assert result['reminders'] == 0
    mock_sqs.send_message.assert_not_called()


@patch.object(send_reminders, 'NOTIFICATIONS_QUEUE_URL', 'https://sqs.test/queue')
@patch('send_reminders.appointments_table')
@patch('send_reminders.sqs')
def test_paginated_results_are_all_reminded(mock_sqs, mock_table):
    # A day with more results than one query page returns must not be truncated.
    mock_table.query.side_effect = [
        {'Items': [appointment('A-1', 'PENDING')], 'LastEvaluatedKey': {'appointmentId': 'A-1'}},
        {'Items': [appointment('A-2', 'PENDING')]},
        {'Items': []},
    ]

    result = lambda_handler({}, None)

    assert result['reminders'] == 2
    assert mock_table.query.call_args_list[1].kwargs['ExclusiveStartKey'] == {'appointmentId': 'A-1'}


@patch.object(send_reminders, 'NOTIFICATIONS_QUEUE_URL', '')
@patch('send_reminders.appointments_table')
@patch('send_reminders.sqs')
def test_missing_queue_url_does_not_crash(mock_sqs, mock_table):
    # Mirrors appointments_common.enqueue_notification: an unconfigured queue is
    # a no-op rather than an unhandled boto3 error on every scheduled run.
    mock_table.query.return_value = {'Items': [appointment('A-1')]}

    result = lambda_handler({}, None)

    assert result['statusCode'] == 200
    mock_sqs.send_message.assert_not_called()
