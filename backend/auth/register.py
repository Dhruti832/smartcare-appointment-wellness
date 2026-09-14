import json
import os
import random
from datetime import datetime, timezone

import boto3

from cipher_utils import caesar_encode
from hashing_utils import hash_text
from validation_utils import (
    ValidationError,
    parse_json_body,
    require,
    validate_choice,
    validate_email,
    validate_length,
)

cognito = boto3.client('cognito-idp')
dynamodb = boto3.resource('dynamodb')
sqs = boto3.client('sqs')

security_table = dynamodb.Table(os.environ.get('USER_SECURITY_TABLE_NAME', 'UserSecurity'))
USER_POOL_ID = os.environ.get('COGNITO_USER_POOL_ID', '')
NOTIFICATIONS_QUEUE_URL = os.environ.get('NOTIFICATIONS_QUEUE_URL', '')

REQUIRED_FIELDS = ['email', 'password', 'role', 'securityQuestion', 'securityAnswer', 'healthcareCode']
ROLE_GROUPS = {'PATIENT': 'Patients', 'COORDINATOR': 'Coordinators'}


def lambda_handler(event, context):
    try:
        body = parse_json_body(event)
        require(body, *REQUIRED_FIELDS)
        username = validate_email(body['email'])
        role = validate_choice(body['role'], 'role', ROLE_GROUPS.keys())
        validate_length(body['password'], 'password')
        validate_length(body['securityQuestion'], 'securityQuestion')
        validate_length(body['securityAnswer'], 'securityAnswer')
        validate_length(body['healthcareCode'], 'healthcareCode')
    except ValidationError as exc:
        return _response(400, {'message': exc.message})

    try:
        cognito.admin_create_user(
            UserPoolId=USER_POOL_ID,
            Username=username,
            UserAttributes=[
                {'Name': 'email', 'Value': username},
                {'Name': 'email_verified', 'Value': 'true'},
            ],
            MessageAction='SUPPRESS',
        )
    except cognito.exceptions.UsernameExistsException:
        return _response(409, {'message': 'An account with this email already exists'})

    cognito.admin_set_user_password(UserPoolId=USER_POOL_ID, Username=username, Password=body['password'], Permanent=True)
    cognito.admin_add_user_to_group(UserPoolId=USER_POOL_ID, Username=username, GroupName=ROLE_GROUPS[role])

    caesar_shift = random.randint(1, 25)
    healthcare_code = body['healthcareCode'].strip().upper()

    security_table.put_item(Item={
        'username': username,
        'securityQuestion': body['securityQuestion'].strip(),
        'securityAnswerHash': hash_text(body['securityAnswer'].strip().lower()),
        'caesarClue': caesar_encode(healthcare_code, caesar_shift),
        'caesarShift': caesar_shift,
        'caesarAnswerHash': hash_text(healthcare_code),
        'createdAt': datetime.now(timezone.utc).isoformat(),
    })

    _notify_registration(username)

    return _response(201, {'message': 'Registration successful', 'username': username, 'role': role})


def _notify_registration(username):
    if not NOTIFICATIONS_QUEUE_URL:
        return
    sqs.send_message(
        QueueUrl=NOTIFICATIONS_QUEUE_URL,
        MessageBody=json.dumps({'action': 'REGISTER', 'patientId': username}),
    )


def _response(status_code, body):
    return {
        'statusCode': status_code,
        'headers': {'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*'},
        'body': json.dumps(body),
    }