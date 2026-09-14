import json
from decimal import Decimal
from unittest.mock import patch

import sys
sys.path.insert(0, '../../backend/feedback')
from submit_feedback import lambda_handler as submit_handler
from list_feedback import lambda_handler as list_handler


def event(claims=None, body=None, query=None):
    e = {}
    if claims is not None:
        e['requestContext'] = {'authorizer': {'jwt': {'claims': claims}}}
    if body is not None:
        e['body'] = json.dumps(body) if isinstance(body, dict) else body
    if query is not None:
        e['queryStringParameters'] = query
    return e


PATIENT = {'email': 'pat@example.com', 'cognito:groups': '[Patients]'}
VALID_FEEDBACK = {
    'appointmentId': 'A1B2C3D4',
    'serviceId': 'svc-001',
    'feedbackText': 'Great experience.',
}


# ── Submit (authenticated) ──────────────────────────────────────────────────
def test_submit_requires_auth():
    result = submit_handler(event(claims={}, body=VALID_FEEDBACK), None)
    assert result['statusCode'] == 401


@patch('submit_feedback.feedback_table')
def test_submit_creates_row_without_sentiment(mock_table):
    result = submit_handler(event(claims=PATIENT, body=VALID_FEEDBACK), None)
    assert result['statusCode'] == 201
    body = json.loads(result['body'])
    assert body['data']['feedbackId'].startswith('fb-')
    assert body['data']['sentimentLabel'] is None

    item = mock_table.put_item.call_args.kwargs['Item']
    # patientUsername comes from the token, never the request body.
    assert item['patientUsername'] == 'pat@example.com'
    assert item['feedbackText'] == 'Great experience.'
    # Must NOT store a sentimentLabel -- the sentiment pipeline skips rows that
    # already carry one, so writing it here would suppress scoring entirely.
    assert 'sentimentLabel' not in item


@patch('submit_feedback.feedback_table')
def test_submit_rejects_missing_fields(mock_table):
    result = submit_handler(event(claims=PATIENT, body={'feedbackText': 'hi'}), None)
    assert result['statusCode'] == 400
    mock_table.put_item.assert_not_called()


def test_submit_rejects_malformed_json():
    result = submit_handler(event(claims=PATIENT, body='{not json'), None)
    assert result['statusCode'] == 400


# ── List (public) ───────────────────────────────────────────────────────────
@patch('list_feedback.feedback_table')
def test_list_all_scans_and_sorts_newest_first(mock_table):
    mock_table.scan.return_value = {'Items': [
        {'feedbackId': 'fb-1', 'createdAt': '2026-01-01T00:00:00'},
        {'feedbackId': 'fb-2', 'createdAt': '2026-03-01T00:00:00'},
    ]}
    result = list_handler(event(), None)
    data = json.loads(result['body'])['data']
    assert result['statusCode'] == 200
    assert [f['feedbackId'] for f in data] == ['fb-2', 'fb-1']
    mock_table.scan.assert_called_once()


@patch('list_feedback.feedback_table')
def test_list_by_service_uses_gsi(mock_table):
    mock_table.query.return_value = {'Items': [{'feedbackId': 'fb-1', 'serviceId': 'svc-001'}]}
    result = list_handler(event(query={'serviceId': 'svc-001'}), None)
    assert result['statusCode'] == 200
    mock_table.query.assert_called_once()
    assert mock_table.query.call_args.kwargs['IndexName'] == 'serviceId-index'
    mock_table.scan.assert_not_called()


@patch('list_feedback.feedback_table')
def test_list_serializes_sentiment_score_as_number(mock_table):
    mock_table.scan.return_value = {'Items': [
        {'feedbackId': 'fb-1', 'sentimentScore': Decimal('0.9'), 'sentimentLabel': 'POSITIVE'},
    ]}
    result = list_handler(event(), None)
    data = json.loads(result['body'])['data'][0]
    assert data['sentimentScore'] == 0.9 and isinstance(data['sentimentScore'], float)
