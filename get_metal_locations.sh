#!/usr/bin/env bash
# Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
# SPDX-License-Identifier: MIT-0
TYPE="m6a.metal,m7a.metal-48xl"
for REGION in $(aws account list-regions --query "Regions[].RegionName" --region-opt-status-contains ENABLED ENABLED_BY_DEFAULT --output text); do
  AVAILABILITY=$(aws ec2 describe-instance-type-offerings \
    --filters Name=instance-type,Values=${TYPE} \
    --query "InstanceTypeOfferings[].InstanceType" \
    --region ${REGION} --output text)
  if [ ! -z "${AVAILABILITY}" ]; then
    echo ${REGION}: $(echo ${AVAILABILITY} | xargs -n1 | sort | xargs)
  fi
done