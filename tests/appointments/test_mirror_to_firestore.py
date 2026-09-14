from unittest.mock import patch

import sys
sys.path.insert(0, '../../backend/appointments')
import mirror_to_firestore
from mirror_to_firestore import lambda_handler


def dynamo_stream_record(appointment_id='A1', date='2026-08-01', service_id='svc-001', status='PENDING', event_name='INSERT'):
    return {
        'eventName': event_name,
        'dynamodb': {
            'NewImage': {
                'appointmentId': {'S': appointment_id},
                'date': {'S': date},
                'serviceId': {'S': service_id},
                'status': {'S': status},
            }
        },
    }


def test_skips_when_export_bucket_not_configured(monkeypatch):
    monkeypatch.delenv('APPOINTMENTS_EXPORT_BUCKET', raising=False)

    with patch.object(mirror_to_firestore, '_s3') as mock_s3:
        result = lambda_handler({'Records': [dynamo_stream_record()]}, None)

    assert result == {'exported': 0}
    mock_s3.put_object.assert_not_called()


@patch('mirror_to_firestore._notify_gcp')
def test_exports_csv_to_s3_and_notifies_gcp(mock_notify, monkeypatch):
    monkeypatch.setenv('APPOINTMENTS_EXPORT_BUCKET', 'saws-appointments-export-dev')

    with patch.object(mirror_to_firestore, '_s3') as mock_s3:
        mock_s3.generate_presigned_url.return_value = 'https://s3.example/presigned'
        result = lambda_handler({'Records': [dynamo_stream_record()]}, None)

    assert result == {'exported': 1}

    put_kwargs = mock_s3.put_object.call_args.kwargs
    assert put_kwargs['Bucket'] == 'saws-appointments-export-dev'
    assert put_kwargs['Key'] == 'appointments/A1.csv'
    body = put_kwargs['Body'].decode('utf-8')
    assert 'refCode,date,service,status' in body
    assert 'A1,2026-08-01,svc-001,PENDING' in body

    mock_notify.assert_called_once_with('A1', 'https://s3.example/presigned')


@patch('mirror_to_firestore._notify_gcp')
def test_remove_events_are_skipped(mock_notify, monkeypatch):
    monkeypatch.setenv('APPOINTMENTS_EXPORT_BUCKET', 'saws-appointments-export-dev')

    with patch.object(mirror_to_firestore, '_s3') as mock_s3:
        result = lambda_handler({'Records': [dynamo_stream_record(event_name='REMOVE')]}, None)

    assert result == {'exported': 0}
    mock_s3.put_object.assert_not_called()
    mock_notify.assert_not_called()


def test_notify_skipped_when_function_url_absent(monkeypatch, capsys):
    monkeypatch.delenv('GCP_MIRROR_FUNCTION_URL', raising=False)

    mirror_to_firestore._notify_gcp('A1', 'https://s3.example/presigned')

    assert 'GCP_MIRROR_FUNCTION_URL not set' in capsys.readouterr().out
