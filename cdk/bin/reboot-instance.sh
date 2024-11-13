#!/usr/bin/env bash
# Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
# SPDX-License-Identifier: MIT-0

echo "Usage: reboot-instance.sh [REGION]"
ApplicationName="RuntimeAttestation"
DEFAULT_REGION=$(aws configure get region)
if [ -z "$1" ]; then
    RegionName=${DEFAULT_REGION}
    echo "Default region:" $RegionName
else
    RegionName=$1
    echo "Selected region:" $RegionName
fi
HostName=bare-metal-0
InstanceId=($(aws ec2 describe-instances --region ${RegionName} --filters "Name=instance-state-name,Values=running" "Name=tag:ApplicationName,Values=${ApplicationName}" "Name=tag:HostName,Values=${HostName}" --query "Reservations[${HostNumber}].Instances[].InstanceId" --output text))
echo Instance ID: ${InstanceId[@]}
Index=0
aws ec2 reboot-instances \
    --region ${RegionName} \
    --instance-ids ${InstanceId[$Index]}
