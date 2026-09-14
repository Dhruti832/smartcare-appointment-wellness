import json
from unittest.mock import patch

import sys
sys.path.insert(0, '../../backend/appointments')
from approve_appointment import lambda_handler as approve_handler
from cancel_appointment import lambda_handler as cancel_handler
from book_appointment import lambda_handler as book_handler


def event(claims=None, body=None, path_params=None):
    e = {}
    if claims is not None:
        e['requestContext'] = {'authorizer': {'jwt': {'claims': claims}}}
    if body is not None:
        e['body'] = json.dumps(body) if isinstance(body, dict) else body
    if path_params is not None:
        e['pathParameters'] = path_params
    return e


PATIENT = {'email': 'pat@example.com', 'cognito:groups': '[Patients]'}
COORDINATOR = {'email': 'coord@example.com', 'cognito:groups': '[Coordinators]'}


# ── Role enforcement (server-side, not UI) ─────────────────────────────────────
def test_patient_cannot_approve():
    result = approve_handler(event(claims=PATIENT, path_params={'appointmentId': 'A1'}), None)
    assert result['statusCode'] == 403


def test_unauthenticated_cannot_approve():
    result = approve_handler(event(claims={}, path_params={'appointmentId': 'A1'}), None)
    assert result['statusCode'] == 401


@patch('approve_appointment.enqueue_notification')
@patch('approve_appointment.write_log')
@patch('approve_appointment.appointments_table')
@patch('approve_appointment.get_appointment_or_none')
def test_coordinator_can_approve_pending(mock_get, mock_table, mock_log, mock_notify):
    mock_get.return_value = {'appointmentId': 'A1', 'patientUsername': 'pat@example.com', 'status': 'PENDING'}
    result = approve_handler(event(claims=COORDINATOR, path_params={'appointmentId': 'A1'}), None)
    assert result['statusCode'] == 200
    assert json.loads(result['body'])['data']['status'] == 'APPROVED'


# ── Ownership enforcement ──────────────────────────────────────────────────────
@patch('cancel_appointment.get_appointment_or_none')
def test_patient_cannot_cancel_someone_elses(mock_get):
    # Appointment belongs to a different patient -> 404 (never reveals it exists).
    mock_get.return_value = {'appointmentId': 'A1', 'patientUsername': 'other@example.com', 'status': 'PENDING'}
    result = cancel_handler(event(claims=PATIENT, path_params={'appointmentId': 'A1'}), None)
    assert result['statusCode'] == 404


# ── Input validation ───────────────────────────────────────────────────────────
def test_book_rejects_malformed_json():
    result = book_handler(event(claims=PATIENT, body='{not valid json'), None)
    assert result['statusCode'] == 400


def test_book_rejects_bad_date():
    bad = {'serviceId': 'svc-001', 'date': '31-08-2026', 'time': '10:00'}
    result = book_handler(event(claims=PATIENT, body=bad), None)
    assert result['statusCode'] == 400
