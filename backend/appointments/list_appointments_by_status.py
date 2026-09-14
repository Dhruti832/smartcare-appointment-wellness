from appointments_common import (
    AuthorizationError,
    ValidationError,
    appointments_table,
    require_coordinator,
    response,
    validate_choice,
)

VALID_STATUSES = {'PENDING', 'APPROVED', 'REJECTED', 'CANCELLED', 'COMPLETED'}


def lambda_handler(event, context):
    try:
        require_coordinator(event)
        status = (event.get('queryStringParameters') or {}).get('status')
        if not status:
            raise ValidationError('status query parameter is required')
        status = validate_choice(status, 'status', VALID_STATUSES)
    except AuthorizationError as exc:
        return response(exc.status, exc.message)
    except ValidationError as exc:
        return response(400, exc.message)

    result = appointments_table.query(
        IndexName='status-date-index',
        KeyConditionExpression='#s = :s',
        ExpressionAttributeNames={'#s': 'status'},
        ExpressionAttributeValues={':s': status},
    )
    return response(200, 'Appointments retrieved', result.get('Items', []))
