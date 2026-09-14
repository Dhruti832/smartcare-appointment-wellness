from appointments_common import (
    AuthorizationError,
    appointments_table,
    enqueue_notification,
    get_appointment_or_none,
    get_path_param,
    now_iso,
    require_authenticated,
    response,
    write_log,
)

CANCELLABLE_STATUSES = {'PENDING', 'APPROVED'}


def lambda_handler(event, context):
    try:
        username = require_authenticated(event)
    except AuthorizationError as exc:
        return response(exc.status, exc.message)

    appointment_id = get_path_param(event, 'appointmentId')
    appointment = get_appointment_or_none(appointment_id)

    if not appointment or appointment['patientUsername'] != username:
        return response(404, 'Appointment not found')
    if appointment['status'] not in CANCELLABLE_STATUSES:
        return response(400, f"Cannot cancel an appointment in {appointment['status']} status")

    appointments_table.update_item(
        Key={'appointmentId': appointment_id},
        UpdateExpression='SET #s = :s, updatedAt = :u',
        ExpressionAttributeNames={'#s': 'status'},
        ExpressionAttributeValues={':s': 'CANCELLED', ':u': now_iso()},
    )

    write_log(appointment_id, 'CANCEL', username)
    enqueue_notification('CANCEL', appointment_id, username)

    return response(200, 'Appointment cancelled', {'status': 'CANCELLED'})
