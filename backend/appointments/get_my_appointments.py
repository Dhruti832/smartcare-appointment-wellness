from appointments_common import (
    AuthorizationError,
    appointments_table,
    require_authenticated,
    response,
)


def lambda_handler(event, context):
    try:
        username = require_authenticated(event)
    except AuthorizationError as exc:
        return response(exc.status, exc.message)

    result = appointments_table.query(
        IndexName='patientUsername-index',
        KeyConditionExpression='patientUsername = :u',
        ExpressionAttributeValues={':u': username},
    )
    return response(200, 'Appointments retrieved', result.get('Items', []))
