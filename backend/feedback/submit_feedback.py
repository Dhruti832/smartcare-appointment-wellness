from feedback_common import (
    AuthorizationError,
    ValidationError,
    feedback_table,
    new_feedback_id,
    now_iso,
    parse_json_body,
    require,
    require_authenticated,
    response,
    validate_length,
)

REQUIRED_FIELDS = ('appointmentId', 'serviceId', 'feedbackText')


def lambda_handler(event, context):
    """POST /feedback -- authenticated patient. The row is created WITHOUT a
    sentimentLabel so the sentiment pipeline (analyze_sentiment.py, triggered
    by this table's DynamoDB Stream) picks it up; that Lambda deliberately
    skips rows that already carry a sentimentLabel."""
    try:
        patient_username = require_authenticated(event)
    except AuthorizationError as exc:
        return response(exc.status, exc.message)

    try:
        body = parse_json_body(event)
        require(body, *REQUIRED_FIELDS)
        appointment_id = validate_length(body['appointmentId'], 'appointmentId')
        service_id = validate_length(body['serviceId'], 'serviceId')
        feedback_text = validate_length(body['feedbackText'], 'feedbackText', max_len=2000)
    except ValidationError as exc:
        return response(400, exc.message)

    feedback_id = new_feedback_id()
    feedback_table.put_item(Item={
        'feedbackId': feedback_id,
        'appointmentId': appointment_id,
        'serviceId': service_id,
        'patientUsername': patient_username,
        'feedbackText': feedback_text,
        'createdAt': now_iso(),
    })

    # sentimentLabel is null now; the pipeline fills it in asynchronously and
    # the frontend re-fetches (per docs/api/api-contract.md §4).
    return response(201, 'Feedback submitted', {'feedbackId': feedback_id, 'sentimentLabel': None})
