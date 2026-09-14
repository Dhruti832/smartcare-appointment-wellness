import json
from decimal import Decimal
from unittest.mock import patch

import sys
sys.path.insert(0, '../../backend/services')
from list_services import lambda_handler as list_handler
from get_service import lambda_handler as get_handler
from create_service import lambda_handler as create_handler
from update_service import lambda_handler as update_handler


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

VALID_SERVICE = {
    'name': 'General Consultation',
    'type': 'consultation',
    'description': 'A general wellness checkup.',
    'durationMinutes': 30,
    'price': 50,
}


# ── List / get (public) ─────────────────────────────────────────────────────
@patch('list_services.services_table')
def test_list_hides_inactive_services(mock_table):
    mock_table.scan.return_value = {'Items': [
        {'serviceId': 'svc-1', 'name': 'Active', 'active': True},
        {'serviceId': 'svc-2', 'name': 'Inactive', 'active': False},
        {'serviceId': 'svc-3', 'name': 'No flag set'},
    ]}
    result = list_handler(event(), None)
    data = json.loads(result['body'])['data']
    assert result['statusCode'] == 200
    assert {s['serviceId'] for s in data} == {'svc-1', 'svc-3'}


@patch('get_service.get_service_or_none')
def test_get_missing_service_returns_404(mock_get):
    mock_get.return_value = None
    result = get_handler(event(path_params={'serviceId': 'svc-404'}), None)
    assert result['statusCode'] == 404


@patch('get_service.get_service_or_none')
def test_decimal_fields_serialize_as_numbers(mock_get):
    # DynamoDB returns numbers as Decimal; the contract types durationMinutes
    # and price as numbers, so the JSON must carry 30/50, not "30"/"50".
    mock_get.return_value = {
        'serviceId': 'svc-1', 'name': 'X', 'durationMinutes': Decimal('30'),
        'price': Decimal('49.99'), 'active': True,
    }
    result = get_handler(event(path_params={'serviceId': 'svc-1'}), None)
    data = json.loads(result['body'])['data']
    assert data['durationMinutes'] == 30 and isinstance(data['durationMinutes'], int)
    assert data['price'] == 49.99 and isinstance(data['price'], float)


# ── Role enforcement (server-side, not UI) ──────────────────────────────────
def test_patient_cannot_create_service():
    result = create_handler(event(claims=PATIENT, body=VALID_SERVICE), None)
    assert result['statusCode'] == 403


def test_unauthenticated_cannot_create_service():
    result = create_handler(event(claims={}, body=VALID_SERVICE), None)
    assert result['statusCode'] == 401


@patch('create_service.services_table')
def test_coordinator_can_create_service(mock_table):
    result = create_handler(event(claims=COORDINATOR, body=VALID_SERVICE), None)
    assert result['statusCode'] == 201
    body = json.loads(result['body'])
    assert body['data']['serviceId'].startswith('svc-')
    mock_table.put_item.assert_called_once()
    item = mock_table.put_item.call_args.kwargs['Item']
    assert item['active'] is True
    assert item['name'] == 'General Consultation'


def test_patient_cannot_update_service():
    result = update_handler(event(claims=PATIENT, path_params={'serviceId': 'svc-1'}, body={'price': 60}), None)
    assert result['statusCode'] == 403


# ── Input validation ─────────────────────────────────────────────────────────
def test_create_rejects_missing_fields():
    result = create_handler(event(claims=COORDINATOR, body={'name': 'X'}), None)
    assert result['statusCode'] == 400


def test_create_rejects_negative_price():
    bad = dict(VALID_SERVICE, price=-10)
    result = create_handler(event(claims=COORDINATOR, body=bad), None)
    assert result['statusCode'] == 400


def test_create_rejects_malformed_json():
    result = create_handler(event(claims=COORDINATOR, body='{not valid json'), None)
    assert result['statusCode'] == 400


# ── Update (partial) ─────────────────────────────────────────────────────────
@patch('update_service.get_service_or_none')
@patch('update_service.services_table')
def test_update_missing_service_returns_404(mock_table, mock_get):
    mock_get.return_value = None
    result = update_handler(event(claims=COORDINATOR, path_params={'serviceId': 'svc-404'}, body={'price': 60}), None)
    assert result['statusCode'] == 404


@patch('update_service.get_service_or_none')
@patch('update_service.services_table')
def test_update_applies_only_provided_fields(mock_table, mock_get):
    existing = dict(VALID_SERVICE, serviceId='svc-1', active=True)
    updated = dict(existing, price=75)
    mock_get.side_effect = [existing, updated]

    result = update_handler(event(claims=COORDINATOR, path_params={'serviceId': 'svc-1'}, body={'price': 75}), None)

    assert result['statusCode'] == 200
    update_kwargs = mock_table.update_item.call_args.kwargs
    assert update_kwargs['ExpressionAttributeValues'] == {':price': 75}


def test_update_rejects_no_fields():
    with patch('update_service.get_service_or_none', return_value=dict(VALID_SERVICE, serviceId='svc-1')):
        result = update_handler(event(claims=COORDINATOR, path_params={'serviceId': 'svc-1'}, body={}), None)
    assert result['statusCode'] == 400


# ── Doctor + promotional package fields ──────────────────────────────────────
@patch('create_service.services_table')
def test_create_stores_doctor_and_promo(mock_table):
    body = dict(VALID_SERVICE, doctorName='Dr. Sarah Chen', promoLabel='Bundle: 3 sessions', discountedPrice=40)
    result = create_handler(event(claims=COORDINATOR, body=body), None)
    assert result['statusCode'] == 201
    item = mock_table.put_item.call_args.kwargs['Item']
    assert item['doctorName'] == 'Dr. Sarah Chen'
    assert item['promoLabel'] == 'Bundle: 3 sessions'
    assert item['discountedPrice'] == 40


@patch('create_service.services_table')
def test_create_omits_optional_fields_when_absent(mock_table):
    result = create_handler(event(claims=COORDINATOR, body=VALID_SERVICE), None)
    assert result['statusCode'] == 201
    item = mock_table.put_item.call_args.kwargs['Item']
    assert 'doctorName' not in item and 'promoLabel' not in item and 'discountedPrice' not in item


@patch('create_service.services_table')
def test_create_rejects_discount_not_below_price(mock_table):
    body = dict(VALID_SERVICE, price=50, discountedPrice=60)
    result = create_handler(event(claims=COORDINATOR, body=body), None)
    assert result['statusCode'] == 400
    mock_table.put_item.assert_not_called()


@patch('update_service.get_service_or_none')
@patch('update_service.services_table')
def test_update_sets_doctor_and_promo(mock_table, mock_get):
    existing = dict(VALID_SERVICE, serviceId='svc-1', active=True)
    mock_get.side_effect = [existing, dict(existing, doctorName='Dr. Osei')]
    body = {'doctorName': 'Dr. Osei', 'promoLabel': 'New patient offer', 'discountedPrice': 45}
    result = update_handler(event(claims=COORDINATOR, path_params={'serviceId': 'svc-1'}, body=body), None)
    assert result['statusCode'] == 200
    values = mock_table.update_item.call_args.kwargs['ExpressionAttributeValues']
    assert values[':doctorName'] == 'Dr. Osei'
    assert values[':promoLabel'] == 'New patient offer'
    assert values[':discountedPrice'] == 45


@patch('update_service.get_service_or_none')
@patch('update_service.services_table')
def test_update_rejects_discount_not_below_stored_price(mock_table, mock_get):
    # price not in the body -> checked against the stored price (50).
    mock_get.return_value = dict(VALID_SERVICE, serviceId='svc-1', price=Decimal('50'))
    result = update_handler(event(claims=COORDINATOR, path_params={'serviceId': 'svc-1'}, body={'discountedPrice': 55}), None)
    assert result['statusCode'] == 400
    mock_table.update_item.assert_not_called()
