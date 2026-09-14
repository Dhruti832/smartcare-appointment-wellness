from appointments_common import (
    AuthorizationError,
    appointment_logs_table,
    get_path_param,
    require_coordinator,
    response,
)


def lambda_handler(event, context):
    try:
        require_coordinator(event)
    except AuthorizationError as exc:
        return response(exc.status, exc.message)

    appointment_id = get_path_param(event, 'appointmentId')
    result = appointment_logs_table.query(
        IndexName='appointmentId-index',
        KeyConditionExpression='appointmentId = :a',
        ExpressionAttributeValues={':a': appointment_id},
    )
    return response(200, 'Logs retrieved', result.get('Items', []))
