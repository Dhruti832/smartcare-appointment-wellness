from appointments_common import (
    AuthorizationError,
    ValidationError,
    appointments_table,
    enqueue_notification,
    get_appointment_or_none,
    get_path_param,
    now_iso,
    parse_json_body,
    require,
    require_coordinator,
    response,
    validate_length,
    write_log,
)


def lambda_handler(event, context):
    try:
        coordinator_username = require_coordinator(event)
        body = parse_json_body(event)
        require(body, 'rejectionReason')
        rejection_reason = validate_length(body['rejectionReason'], 'rejectionReason').strip()
    except AuthorizationError as exc:
        return response(exc.status, exc.message)
    except ValidationError as exc:
        return response(400, exc.message)

    appointment_id = get_path_param(event, 'appointmentId')
    appointment = get_appointment_or_none(appointment_id)

    if not appointment:
        return response(404, 'Appointment not found')
    if appointment['status'] != 'PENDING':
        return response(400, f"Cannot reject an appointment in {appointment['status']} status")

    appointments_table.update_item(
        Key={'appointmentId': appointment_id},
        UpdateExpression='SET #s = :s, coordinatorUsername = :c, rejectionReason = :r, updatedAt = :u',
        ExpressionAttributeNames={'#s': 'status'},
        ExpressionAttributeValues={
            ':s': 'REJECTED',
            ':c': coordinator_username,
            ':r': rejection_reason,
            ':u': now_iso(),
        },
    )

    write_log(appointment_id, 'REJECT', coordinator_username, rejection_reason)
    enqueue_notification('REJECT', appointment_id, appointment['patientUsername'])

    return response(200, 'Appointment rejected', {'status': 'REJECTED'})
