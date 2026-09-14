from services_common import get_path_param, get_service_or_none, response


def lambda_handler(event, context):
    """GET /services/{serviceId} -- public."""
    service_id = get_path_param(event, 'serviceId')
    service = get_service_or_none(service_id)
    if not service:
        return response(404, 'Service not found')
    return response(200, 'Service retrieved', service)
