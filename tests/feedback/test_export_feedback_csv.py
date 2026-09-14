import json
import urllib.error
from unittest.mock import patch

import sys
sys.path.insert(0, '../../backend/feedback')
from export_feedback_csv import lambda_handler


def dynamo_stream_record(feedback_id='FB-1', patient='anita', appointment_id='APT-1', service_id='svc-1',
                          text='Great service', score='0.8', magnitude='0.9', label='POSITIVE',
                          created_at='2026-07-01', event_name='MODIFY', include_label=True):
    image = {
        'feedbackId': {'S': feedback_id},
        'patientUsername': {'S': patient},
        'appointmentId': {'S': appointment_id},
        'serviceId': {'S': service_id},
        'feedbackText': {'S': text},
        'createdAt': {'S': created_at},
    }
    if include_label:
        image.update({
            'sentimentScore': {'N': score},
            'sentimentMagnitude': {'N': magnitude},
            'sentimentLabel': {'S': label},
        })
    return {'eventName': event_name, 'dynamodb': {'NewImage': image}}


def _event(*records):
    return {'Records': list(records)}


@patch('export_feedback_csv._s3')
def test_insert_events_are_skipped(mock_s3, monkeypatch):
    monkeypatch.setenv('FEEDBACK_EXPORT_BUCKET', 'bucket')

    result = lambda_handler(_event(dynamo_stream_record(event_name='INSERT')), None)

    assert result['exported'] == 0
    mock_s3.put_object.assert_not_called()


@patch('export_feedback_csv._s3')
def test_modify_without_sentiment_is_skipped(mock_s3, monkeypatch):
    monkeypatch.setenv('FEEDBACK_EXPORT_BUCKET', 'bucket')

    result = lambda_handler(_event(dynamo_stream_record(include_label=False)), None)

    assert result['exported'] == 0
    mock_s3.put_object.assert_not_called()


@patch('export_feedback_csv._s3')
def test_missing_bucket_env_skips_without_crash(mock_s3, monkeypatch):
    monkeypatch.delenv('FEEDBACK_EXPORT_BUCKET', raising=False)

    result = lambda_handler(_event(dynamo_stream_record()), None)

    assert result['exported'] == 0
    mock_s3.put_object.assert_not_called()


@patch('export_feedback_csv.urllib.request.urlopen')
@patch('export_feedback_csv._s3')
def test_scored_feedback_is_exported_and_gcp_notified(mock_s3, mock_urlopen, monkeypatch):
    monkeypatch.setenv('FEEDBACK_EXPORT_BUCKET', 'saws-feedback-export-dev')
    monkeypatch.setenv('GCP_MIRROR_FUNCTION_URL', 'https://gcp.example.com/feedbackMirror')
    monkeypatch.setenv('GCP_MIRROR_SHARED_SECRET', 'shh')
    mock_s3.generate_presigned_url.return_value = 'https://s3.example.com/presigned'
    mock_urlopen.return_value.__enter__.return_value.read.return_value = b'OK'

    result = lambda_handler(_event(dynamo_stream_record()), None)

    assert result['exported'] == 1

    put_kwargs = mock_s3.put_object.call_args.kwargs
    assert put_kwargs['Bucket'] == 'saws-feedback-export-dev'
    assert put_kwargs['Key'] == 'feedback/FB-1.csv'
    body = put_kwargs['Body'].decode('utf-8')
    assert 'feedbackId,patientUsername,appointmentId,serviceId,feedbackText,sentimentScore,sentimentMagnitude,sentimentLabel,createdAt' in body
    assert 'FB-1,anita,APT-1,svc-1,Great service,0.8,0.9,POSITIVE,2026-07-01' in body

    mock_s3.generate_presigned_url.assert_called_once_with(
        'get_object',
        Params={'Bucket': 'saws-feedback-export-dev', 'Key': 'feedback/FB-1.csv'},
        ExpiresIn=600,
    )

    request = mock_urlopen.call_args.args[0]
    assert request.full_url == 'https://gcp.example.com/feedbackMirror'
    assert request.headers['X-export-token'] == 'shh'
    payload = json.loads(request.data.decode('utf-8'))
    assert payload == {'feedbackId': 'FB-1', 'csvUrl': 'https://s3.example.com/presigned'}


@patch('export_feedback_csv.urllib.request.urlopen')
@patch('export_feedback_csv._s3')
def test_gcp_notify_failure_does_not_raise(mock_s3, mock_urlopen, monkeypatch):
    monkeypatch.setenv('FEEDBACK_EXPORT_BUCKET', 'bucket')
    monkeypatch.setenv('GCP_MIRROR_FUNCTION_URL', 'https://gcp.example.com/feedbackMirror')
    mock_s3.generate_presigned_url.return_value = 'https://s3.example.com/presigned'
    mock_urlopen.side_effect = urllib.error.URLError('boom')

    result = lambda_handler(_event(dynamo_stream_record()), None)

    assert result['exported'] == 1


@patch('export_feedback_csv._s3')
def test_no_gcp_endpoint_configured_still_exports(mock_s3, monkeypatch):
    monkeypatch.setenv('FEEDBACK_EXPORT_BUCKET', 'bucket')
    monkeypatch.delenv('GCP_MIRROR_FUNCTION_URL', raising=False)
    mock_s3.generate_presigned_url.return_value = 'https://s3.example.com/presigned'

    result = lambda_handler(_event(dynamo_stream_record()), None)

    assert result['exported'] == 1
    mock_s3.generate_presigned_url.assert_called_once()
