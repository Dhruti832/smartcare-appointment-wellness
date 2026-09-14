import json

import sys
sys.path.insert(0, '../../backend/auth')
from get_profile import lambda_handler


def make_event(claims):
    return {'requestContext': {'authorizer': {'jwt': {'claims': claims}}}} if claims else {'requestContext': {}}


def test_returns_userid_email_and_roles_from_claims():
    # API Gateway's HTTP API JWT authorizer stringifies array claims with
    # brackets kept, e.g. "[Coordinators]" rather than a plain "Coordinators".
    event = make_event({'sub': 'u1', 'email': 'coordinator@example.com', 'cognito:groups': '[Coordinators]'})
    result = lambda_handler(event, None)
    body = json.loads(result['body'])

    assert result['statusCode'] == 200
    assert body['userId'] == 'u1'
    assert body['roles'] == ['Coordinators']


def test_parses_multiple_groups():
    event = make_event({'sub': 'u2', 'email': 'multi@example.com', 'cognito:groups': '[Patients, Coordinators]'})
    result = lambda_handler(event, None)
    body = json.loads(result['body'])

    assert body['roles'] == ['Patients', 'Coordinators']


def test_missing_claims_returns_401():
    result = lambda_handler(make_event(None), None)
    assert result['statusCode'] == 401