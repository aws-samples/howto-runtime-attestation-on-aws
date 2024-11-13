# Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
# SPDX-License-Identifier: MIT-0
from typing import Union
import json
import os
import logging
import boto3
logging.getLogger().setLevel(logging.INFO)
logger = logging.getLogger(__name__)

REGION = os.environ.get('region')
ssm_client = boto3.client('ssm',region_name=REGION)

def main(event, context):
    logger.info("image builder completed")
    logger.info(event)
    logger.info(event.get("Records")[0].get("Sns").get("Message"))

    topic = event.get("Records")[0].get("Sns").get("TopicArn").split(":")[-1]
    message_body = event.get("Records")[0].get("Sns").get("Message")
    json_body = json.loads(message_body)
    logger.info(json_body["outputResources"]["amis"][0]["image"])
    ami = json_body["outputResources"]["amis"][0]["image"]
    logger.info(f"ami {ami}")
    if topic == os.environ.get('topic_arch_any'):
        ssm_key = os.environ["parameter_arch_any"]
    elif topic == os.environ.get('topic_arm64'):
        ssm_key = os.environ["parameter_arch_arm64"]
    elif topic == os.environ.get('topic_x86'):
        ssm_key = os.environ["parameter_arch_x86"]
    else:
        logger.error('Undefined topic')
    logger.info(f"updating ssm {ssm_key}")
    try:
        result = ssm_client.put_parameter(
            Name=ssm_key,
            Value=ami,
            Overwrite=True,
        )
        logger.info("Result of ssm put parameter")
        logger.info(result)
    except Exception as e:
        logger.error(e)

    return create_response(200, {})
    
def create_response(code: int, body: Union[dict, str]):
    json_content = {
        "statusCode": code,
    }
    return json_content

if __name__ == "__main__":
    main(None, None)
