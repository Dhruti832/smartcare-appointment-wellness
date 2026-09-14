from boto3.dynamodb.conditions import Key

from feedback_common import feedback_table, response


def lambda_handler(event, context):
    """GET /feedback -- public. Optional ?serviceId= filters via the
    serviceId-index GSI; without it, returns all feedback."""
    service_id = (event.get('queryStringParameters') or {}).get('serviceId')

    if service_id:
        result = feedback_table.query(
            IndexName='serviceId-index',
            KeyConditionExpression=Key('serviceId').eq(service_id),
        )
    else:
        result = feedback_table.scan()

    # Newest first so the guest page and dashboards show recent feedback on top.
    items = sorted(result.get('Items', []), key=lambda f: f.get('createdAt', ''), reverse=True)
    return response(200, 'Feedback retrieved', items)
