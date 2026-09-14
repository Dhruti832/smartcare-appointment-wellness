import json
import os
import urllib.error
import urllib.request
from decimal import Decimal

import boto3

# Feedback sentiment (Module 5, analytics). Per architectural_decisions.md §9,
# feedback lives in saws-feedback (DynamoDB); this Lambda scores it and writes the
# result back into the same row, triggered by the feedback table's DynamoDB Stream.
#
# Engine: Google Cloud Natural Language API, called over REST with an API key.
# (Amazon Comprehend was the first choice, but the AWS Academy Learner Lab LabRole
# is not authorized for comprehend:DetectSentiment.) Only this single outbound
# sentiment call crosses to GCP — the feedback data itself never leaves AWS.

NL_URL = "https://language.googleapis.com/v1/documents:analyzeSentiment?key=" + os.environ["GOOGLE_API_KEY"]
table = boto3.resource("dynamodb").Table(os.environ["FEEDBACK_TABLE_NAME"])


def _label_for(score):
    # Match the ERD's 3-value convention (POSITIVE | NEUTRAL | NEGATIVE).
    if score >= 0.25:
        return "POSITIVE"
    if score <= -0.25:
        return "NEGATIVE"
    return "NEUTRAL"


def _score(text):
    body = json.dumps({
        "document": {"type": "PLAIN_TEXT", "content": text},
        "encodingType": "UTF8",
    }).encode("utf-8")
    req = urllib.request.Request(NL_URL, data=body, headers={"Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=10) as resp:
            result = json.load(resp)
    except urllib.error.HTTPError as e:
        # Surface the API's own message (bad key, API not enabled, etc.) in the log.
        raise RuntimeError(f"Natural Language API {e.code}: {e.read().decode()}") from e

    s = result["documentSentiment"]  # score: -1.0..1.0, magnitude: 0..inf
    score = round(s["score"], 4)
    magnitude = round(s["magnitude"], 4)
    return score, magnitude, _label_for(score)


def lambda_handler(event, context):
    # DynamoDB Stream trigger on saws-feedback. Scores new feedback rows and writes
    # the sentiment back to the same item. Rows that already carry a sentimentLabel
    # are skipped so our own UpdateItem (a MODIFY event) does not re-trigger analysis.
    processed = 0
    for record in event.get("Records", []):
        if record["eventName"] not in ("INSERT", "MODIFY"):
            continue

        image = record["dynamodb"].get("NewImage", {})
        if "sentimentLabel" in image:
            continue

        feedback_id = image.get("feedbackId", {}).get("S")
        text = image.get("feedbackText", {}).get("S")
        if not feedback_id or not text:
            continue

        score, magnitude, label = _score(text)
        table.update_item(
            Key={"feedbackId": feedback_id},
            UpdateExpression="SET sentimentScore = :s, sentimentMagnitude = :m, sentimentLabel = :l",
            ExpressionAttributeValues={
                ":s": Decimal(str(score)),
                ":m": Decimal(str(magnitude)),
                ":l": label,
            },
        )
        processed += 1
        print(f"Scored feedback {feedback_id}: {label} ({score})")

    return {"processed": processed}
