from appointments_common import (
    AuthorizationError,
    appointments_table,
    enqueue_notification,
    get_appointment_or_none,
    get_path_param,
    now_iso,
    require_coordinator,
    response,
    write_log,
)


def lambda_handler(event, context):
    try:
        coordinator_username = require_coordinator(event)
    except AuthorizationError as exc:
        return response(exc.status, exc.message)

    appointment_id = get_path_param(event, 'appointmentId')
    appointment = get_appointment_or_none(appointment_id)

    if not appointment:
        return response(404, 'Appointment not found')
    if appointment['status'] != 'PENDING':
        return response(400, f"Cannot approve an appointment in {appointment['status']} status")

    appointments_table.update_item(
        Key={'appointmentId': appointment_id},
        UpdateExpression='SET #s = :s, coordinatorUsername = :c, updatedAt = :u',
        ExpressionAttributeNames={'#s': 'status'},
        ExpressionAttributeValues={':s': 'APPROVED', ':c': coordinator_username, ':u': now_iso()},
    )

    write_log(appointment_id, 'APPROVE', coordinator_username)
    enqueue_notification('APPROVE', appointment_id, appointment['patientUsername'])

    return response(200, 'Appointment approved', {'status': 'APPROVED'})
