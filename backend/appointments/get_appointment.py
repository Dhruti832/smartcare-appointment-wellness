from appointments_common import (
    AuthorizationError,
    get_appointment_or_none,
    get_path_param,
    is_coordinator,
    require_authenticated,
    response,
)


def lambda_handler(event, context):
    try:
        username = require_authenticated(event)
    except AuthorizationError as exc:
        return response(exc.status, exc.message)

    appointment_id = get_path_param(event, 'appointmentId')
    appointment = get_appointment_or_none(appointment_id)

    # A patient may only see their own appointment; a coordinator may see any.
    # Both the "not found" and "not yours" cases return 404 so the endpoint
    # never reveals whether an appointment id exists to someone not entitled
    # to it.
    if not appointment:
        return response(404, 'Appointment not found')
    if appointment['patientUsername'] != username and not is_coordinator(event):
        return response(404, 'Appointment not found')

    return response(200, 'Appointment retrieved', appointment)
