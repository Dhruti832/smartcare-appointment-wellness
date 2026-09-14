from services_common import (
    AuthorizationError,
    ValidationError,
    new_service_id,
    parse_json_body,
    require,
    require_coordinator,
    response,
    services_table,
    validate_length,
    validate_positive_number,
)

REQUIRED_FIELDS = ('name', 'type', 'description', 'durationMinutes', 'price')


def lambda_handler(event, context):
    """POST /services -- Coordinator only."""
    try:
        require_coordinator(event)
    except AuthorizationError as exc:
        return response(exc.status, exc.message)

    try:
        body = parse_json_body(event)
        require(body, *REQUIRED_FIELDS)
        name = validate_length(body['name'], 'name')
        service_type = validate_length(body['type'], 'type')
        description = validate_length(body['description'], 'description', max_len=2000)
        duration = validate_positive_number(body['durationMinutes'], 'durationMinutes')
        price = validate_positive_number(body['price'], 'price')

        item = {
            'serviceId': new_service_id(),
            'name': name,
            'type': service_type,
            'description': description,
            'durationMinutes': int(duration),
            'price': price,
            'active': True,
        }
        # Optional doctor/specialist and promotional-package fields -- stored
        # only when supplied so existing catalog behaviour is unchanged.
        _apply_optional_fields(item, body, price)
    except ValidationError as exc:
        return response(400, exc.message)

    services_table.put_item(Item=item)
    return response(201, 'Service created', {'serviceId': item['serviceId']})


def _apply_optional_fields(item, body, price):
    if body.get('doctorName'):
        item['doctorName'] = validate_length(body['doctorName'], 'doctorName')
    if body.get('promoLabel'):
        item['promoLabel'] = validate_length(body['promoLabel'], 'promoLabel')
    if body.get('discountedPrice') not in (None, ''):
        discounted = validate_positive_number(body['discountedPrice'], 'discountedPrice')
        if discounted >= price:
            raise ValidationError('discountedPrice must be less than price')
        item['discountedPrice'] = discounted
