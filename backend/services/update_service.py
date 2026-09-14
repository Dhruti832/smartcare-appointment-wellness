from decimal import Decimal

from services_common import (
    AuthorizationError,
    ValidationError,
    get_path_param,
    get_service_or_none,
    parse_json_body,
    response,
    services_table,
    validate_length,
    validate_positive_number,
    require_coordinator,
)

# Each entry maps a request field to (DynamoDB attribute name, validator).
# 'active' is a plain bool, not free text, so it skips the validators below.
# doctorName / promoLabel / discountedPrice are the optional doctor and
# promotional-package fields; discountedPrice also gets a cross-field check
# against price (below), which a per-field validator can't express.
FIELD_VALIDATORS = {
    'name': lambda v: validate_length(v, 'name'),
    'type': lambda v: validate_length(v, 'type'),
    'description': lambda v: validate_length(v, 'description', max_len=2000),
    'durationMinutes': lambda v: int(validate_positive_number(v, 'durationMinutes')),
    'price': lambda v: validate_positive_number(v, 'price'),
    'doctorName': lambda v: validate_length(v, 'doctorName'),
    'promoLabel': lambda v: validate_length(v, 'promoLabel'),
    'discountedPrice': lambda v: validate_positive_number(v, 'discountedPrice'),
}


def lambda_handler(event, context):
    """PUT /services/{serviceId} -- Coordinator only. Any subset of
    name/type/description/durationMinutes/price/active/doctorName/promoLabel/
    discountedPrice may be supplied."""
    try:
        require_coordinator(event)
    except AuthorizationError as exc:
        return response(exc.status, exc.message)

    service_id = get_path_param(event, 'serviceId')
    service = get_service_or_none(service_id)
    if not service:
        return response(404, 'Service not found')

    try:
        body = parse_json_body(event)
        updates = {field: validator(body[field]) for field, validator in FIELD_VALIDATORS.items() if field in body}
        if 'active' in body:
            updates['active'] = bool(body['active'])
        _check_discount(updates, service)
    except ValidationError as exc:
        return response(400, exc.message)

    if not updates:
        return response(400, 'No updatable fields provided')

    expr_names = {f'#{k}': k for k in updates}
    expr_values = {f':{k}': v for k, v in updates.items()}
    services_table.update_item(
        Key={'serviceId': service_id},
        UpdateExpression='SET ' + ', '.join(f'#{k} = :{k}' for k in updates),
        ExpressionAttributeNames=expr_names,
        ExpressionAttributeValues=expr_values,
    )

    updated = get_service_or_none(service_id)
    return response(200, 'Service updated', updated)


def _check_discount(updates, service):
    """A promo's discountedPrice must be below the service price -- compared
    against the incoming price if it's being changed too, otherwise the stored
    one."""
    if 'discountedPrice' not in updates:
        return
    effective_price = updates.get('price', service.get('price'))
    if effective_price is not None and updates['discountedPrice'] >= Decimal(str(effective_price)):
        raise ValidationError('discountedPrice must be less than price')
