#!/usr/bin/env bash
# Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
# SPDX-License-Identifier: MIT-0

echo "Usage: delete-image-builder-images.sh [REGION]"
DEFAULT_REGION=$(aws configure get region)

if [ -z "$1" ]; then
    REGION=${DEFAULT_REGION}
    echo "Default region:" $REGION
else
    REGION=$2
    echo "Selected region:" $REGION
fi

IMAGE_NAME="UbuntuSevSnpHostImage,UbuntuSevSnpEksHostImage"

# List Image Builder images and select one
echo "Available Image Builder images:"
aws imagebuilder list-images \
    --filters "name=name,values=${IMAGE_NAME}" \
    --query "imageVersionList[*].{Name:name,Version:version,ARN:arn}" \
    --output table \
    --region $REGION

echo "Enter the ARN of the image you want to delete:"
read IMAGE_ARN

# Delete the Image Builder image
echo "Deleting Image Builder image..."
aws imagebuilder delete-image --image-build-version-arn $IMAGE_ARN --region $REGION

# Find and deregister the AMI
AMI_ID=$(aws ec2 describe-images --owners self --query 'Images[?Tags[?Key==`Ec2ImageBuilderArn` && Value==`'$IMAGE_ARN'`]].ImageId' --output text --region $REGION)
if [ -n "$AMI_ID" ]; then
    echo "Deregistering AMI $AMI_ID..."
    aws ec2 deregister-image --image-id $AMI_ID --region $REGION
else
    echo "No matching AMI found."
fi

# Find and delete associated snapshots
SNAPSHOT_IDS=$(aws ec2 describe-snapshots --owner-ids self --filters "Name=description,Values=*$AMI_ID*" --query 'Snapshots[*].[SnapshotId]' --output text --region $REGION)
for SNAPSHOT_ID in $SNAPSHOT_IDS; do
    echo "Deleting snapshot $SNAPSHOT_ID..."
    aws ec2 delete-snapshot --snapshot-id $SNAPSHOT_ID --region $REGION
done

echo "Cleanup complete."
