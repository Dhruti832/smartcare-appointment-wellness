from services_common import response, services_table


def lambda_handler(event, context):
    """GET /services -- public. Lists active services only; a service with
    active explicitly set to False is hidden without being deleted."""
    result = services_table.scan()
    items = [item for item in result.get('Items', []) if item.get('active', True)]
    return response(200, 'Services retrieved', items)
