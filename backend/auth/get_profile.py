import json

# Sits behind API Gateway's Cognito JWT authorizer, which already verified the
# token signature/expiry before invoking this function and forwards the
# decoded claims — this is the proof-point for role-based access.


def lambda_handler(event, context):
    claims = event.get('requestContext', {}).get('authorizer', {}).get('jwt', {}).get('claims', {})

    if not claims:
        return _response(401, {'message': 'Missing or invalid authorization'})

    # API Gateway's HTTP API JWT authorizer stringifies array claims as
    # "[a, b]" (brackets kept) rather than a plain comma-joined list.
    groups = claims.get('cognito:groups', '')
    groups = groups.strip('[]') if isinstance(groups, str) else ''
    roles = [g.strip() for g in groups.split(',') if g.strip()]

    return _response(200, {
        'userId': claims.get('sub'),
        'email': claims.get('email'),
        'roles': roles,
    })


def _response(status_code, body):
    return {
        'statusCode': status_code,
        'headers': {'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*'},
        'body': json.dumps(body),
    }