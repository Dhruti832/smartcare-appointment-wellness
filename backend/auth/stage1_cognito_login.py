import json
import os
import boto3

from auth_sessions import create_session
from validation_utils import ValidationError, parse_json_body, require, validate_email

cognito = boto3.client('cognito-idp')
dynamodb = boto3.resource('dynamodb')
security_table = dynamodb.Table(os.environ.get('USER_SECURITY_TABLE_NAME', 'UserSecurity'))
sessions_table = dynamodb.Table(os.environ.get('AUTH_SESSIONS_TABLE_NAME', 'AuthSessions'))
CLIENT_ID = os.environ.get('COGNITO_CLIENT_ID', '')
USER_POOL_ID = os.environ.get('COGNITO_USER_POOL_ID', '')


def lambda_handler(event, context):
    try:
        body = parse_json_body(event)
        require(body, 'username', 'password')
        username = validate_email(body['username'], field='username')
    except ValidationError as exc:
        return _response(400, {'message': exc.message})

    password = body['password']

    try:
        # admin_initiate_auth (ADMIN_USER_PASSWORD_AUTH) runs the password
        # check server-side using this Lambda's IAM role. The client-facing
        # USER_PASSWORD_AUTH flow is deliberately disabled on the app client so
        # a caller cannot authenticate directly against Cognito and obtain a
        # token that skips MFA stages 2 & 3 -- the only way to a token is
        # through all three stages of this API.
        auth_result = cognito.admin_initiate_auth(
            UserPoolId=USER_POOL_ID,
            ClientId=CLIENT_ID,
            AuthFlow='ADMIN_USER_PASSWORD_AUTH',
            AuthParameters={'USERNAME': username, 'PASSWORD': password},
        )['AuthenticationResult']
    except (cognito.exceptions.NotAuthorizedException, cognito.exceptions.UserNotFoundException):
        return _response(401, {'message': 'Invalid credentials'})

    security = security_table.get_item(Key={'username': username}).get('Item')
    if not security:
        return _response(404, {'message': 'User profile not found'})

    session_id = create_session(sessions_table, username, {
        'idToken': auth_result['IdToken'],
        'accessToken': auth_result['AccessToken'],
        'refreshToken': auth_result['RefreshToken'],
    })

    return _response(200, {
        'message': 'Stage 1 passed',
        'sessionId': session_id,
        'securityQuestion': security.get('securityQuestion'),
    })


def _response(status_code, body):
    return {
        'statusCode': status_code,
        'headers': {'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*'},
        'body': json.dumps(body),
    }