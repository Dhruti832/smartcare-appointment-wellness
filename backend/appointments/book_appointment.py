import uuid

from boto3.dynamodb.conditions import Attr

from appointments_common import (
    AuthorizationError,
    ValidationError,
    appointments_table,
    enqueue_notification,
    get_service_or_none,
    now_iso,
    parse_json_body,
    require,
    require_patient,
    response,
    validate_date,
    validate_length,
    validate_time,
    write_log,
)

REQUIRED_FIELDS = ['serviceId', 'date', 'time']

# A slot is taken while a request is outstanding or already accepted; REJECTED
# and CANCELLED appointments release it again.
BLOCKING_STATUSES = ('PENDING', 'APPROVED')


def lambda_handler(event, context):
    try:
        username = require_patient(event)
    except AuthorizationError as exc:
        return response(exc.status, exc.message)

    try:
        body = parse_json_body(event)
        require(body, *REQUIRED_FIELDS)
        service_id = validate_length(body['serviceId'], 'serviceId')
        appt_date = validate_date(body['date'])
        appt_time = validate_time(body['time'])
    except ValidationError as exc:
        return response(400, exc.message)

    if get_service_or_none(service_id) is None:
        return response(400, f'Service {service_id} does not exist')

    if _slot_taken(service_id, appt_date, appt_time):
        return response(409, f'That slot is already booked for {appt_date} at {appt_time}')

    appointment_id = uuid.uuid4().hex[:8].upper()
    timestamp = now_iso()

    appointments_table.put_item(Item={
        'appointmentId': appointment_id,
        'patientUsername': username,
        'serviceId': service_id,
        'date': appt_date,
        'time': appt_time,
        'status': 'PENDING',
        'createdAt': timestamp,
        'updatedAt': timestamp,
    })

    write_log(appointment_id, 'BOOK', username, f'Booked for {appt_date} {appt_time}')
    enqueue_notification('BOOK', appointment_id, username)

    return response(201, 'Appointment booked', {'appointmentId': appointment_id, 'status': 'PENDING'})


def _slot_taken(service_id, appt_date, appt_time):
    """True when this service already has a live appointment at this date/time.

    A scan rather than a query: the table's key is appointmentId alone, so
    there's no index to look date/time up by. Fine at course scale; a
    serviceId-date GSI would be the fix if the table ever grows.
    """
    result = appointments_table.scan(
        FilterExpression=Attr('serviceId').eq(service_id)
        & Attr('date').eq(appt_date)
        & Attr('time').eq(appt_time)
        & Attr('status').is_in(list(BLOCKING_STATUSES)),
        ProjectionExpression='appointmentId',
    )
    return bool(result.get('Items'))
