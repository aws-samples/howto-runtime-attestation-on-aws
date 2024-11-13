#!/usr/bin/env bash
# Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
# SPDX-License-Identifier: MIT-0

echo "Usage: connect-to-instance-via-ssm-session-to.sh HOSTNAME [INDEX] [REGION]"
echo "Example (short): connect-to-instance-via-ssm-session-to.sh bare-metal-0"
echo "Example (long):  connect-to-instance-via-ssm-session-to.sh bare-metal-0 0 eu-central-1"
ApplicationName="RuntimeAttestation"
DEFAULT_REGION=$(aws configure get region)
SESSION_DOCUMENT_NAME=SessionRegionalSettingsUbuntu
if [ -z "$2" ]; then
    Index=0
    echo "Default index:" $Index
else
    Index=$2
    echo "Selected index:" $Index
fi
if [ -z "$3" ]; then
    RegionName=${DEFAULT_REGION}
    echo "Default region:" $RegionName
else
    RegionName=$3
    echo "Selected region:" $RegionName
fi
if [ "$1" == "list" ]; then
    echo "Available instances:"
    INSTANCES=$(aws ec2 describe-instances --region ${RegionName} --filters "Name=instance-state-name,Values=running" "Name=tag:ApplicationName,Values=${ApplicationName}" --query "Reservations[].Instances[].Tags[?Key=='HostName'].Value" --output text)
    echo $INSTANCES | xargs -n1 | sort | xargs
    exit 0
fi

HostName=$1

InstanceId=($(aws ec2 describe-instances --region ${RegionName} --filters "Name=instance-state-name,Values=running" "Name=tag:ApplicationName,Values=${ApplicationName}" "Name=tag:HostName,Values=${HostName}" --query "Reservations[${HostNumber}].Instances[].InstanceId" --output text))

echo Instance ID: ${InstanceId[@]}
aws ssm start-session  --region ${RegionName} --target ${InstanceId[$Index]}  --document-name ${SESSION_DOCUMENT_NAME}
