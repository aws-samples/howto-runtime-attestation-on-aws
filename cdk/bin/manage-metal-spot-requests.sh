#!/usr/bin/env bash
# Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
# SPDX-License-Identifier: MIT-0

echo "Usage: manage_spot_requests.sh list|delete [REGION]"
DEFAULT_REGION=$(aws configure get region)

# Argument parsing
COMMAND="list"
if [ -z "$1" ]; then
    echo "No command specified (list or delete)"
    exit 1
else
    if [ "$1" == "list" ]; then
        COMMAND=list
    elif [ "$1" == "delete" ]; then
        COMMAND=delete
    else
        echo "Invalid command:" $1 "(list or delete)"
        exit 1
    fi
fi
if [ -z "$2" ]; then
    REGION=${DEFAULT_REGION}
    echo "Default region:" $REGION
else
    REGION=$2
    echo "Selected region:" $REGION
fi

# Execute command
if [ "$COMMAND" == "list" ]; then
    aws ec2 describe-spot-instance-requests \
        --region ${REGION} \
        --filters "Name=state,Values=active" "Name=launch.instance-type,Values=*metal" \
        --query "SpotInstanceRequests[*].{SpotInstanceRequestId:SpotInstanceRequestId,InstanceType:LaunchSpecification.InstanceType,InstanceId:InstanceId,State:State,Status:Status}" \
        --output json
elif [ "$COMMAND" == "delete" ]; then
    METAL_SPOT_REQUESTS=$(aws ec2 describe-spot-instance-requests \
        --region ${REGION} \
        --filters "Name=launch.instance-type,Values=*metal" "Name=state,Values=active" \
        --query "SpotInstanceRequests[*].SpotInstanceRequestId" \
        --output text)
    if [ -n "$METAL_SPOT_REQUESTS" ]; then
        echo "Metal spot requests:" $METAL_SPOT_REQUESTS
         aws ec2 cancel-spot-instance-requests \
            --region ${REGION} \
            --spot-instance-request-ids $METAL_SPOT_REQUESTS
    else
        echo "No active Spot Instance requests found for metal instances."
    fi
fi
