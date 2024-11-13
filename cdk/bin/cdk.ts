#!/usr/bin/env node
// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// # SPDX-License-Identifier: MIT-0
import * as cdk from 'aws-cdk-lib';
import { ComputeStack } from '../lib/compute-stack';
import { ImageBuilderStack } from '../lib/image-builder-stack';
import { InstanceClass, InstanceSize } from 'aws-cdk-lib/aws-ec2';
import { AwsSolutionsChecks, NagSuppressions } from 'cdk-nag';


const region = process.env.CDK_DEFAULT_REGION || 'us-east-1';
const account = process.env.CDK_DEFAULT_ACCOUNT;
const owner = 'rmz@';
const applicationName = 'RuntimeAttestation';
const stackNamePrefix = 'ra';

const regionCode = region.split("-")[0].slice(0,2)+region.split("-")[1].slice(0,1)+region.split("-")[2].slice(0,1);
console.log('Selected region:',region,regionCode.toUpperCase());

let amiIdParameterPath: string;
let instanceClass: InstanceClass;
let instanceSize: InstanceSize;
const eksAmiIdParameterPath = '/aws/service/canonical/ubuntu/eks/22.04/1.31/stable/current/amd64/hvm/ebs-gp2/ami-id'
const defaultAmiIdParameterPath = '/aws/service/canonical/ubuntu/server/24.04/stable/current/amd64/hvm/ebs-gp3/ami-id'
const buildHostAmiIdNameParameterPath = '/'+applicationName+'/ImageBuilder/Host/Ubuntu/AMI/ID'
const buildEksHostAmiIdNameParameterPath = '/'+applicationName+'/ImageBuilder/EksHost/Ubuntu/AMI/ID'

const app = new cdk.App();
cdk.Aspects.of(app).add(new AwsSolutionsChecks());

const useCustomAmi: string = app.node.tryGetContext('useCustomAmi');
if ( useCustomAmi === 'true' ) {
  console.log('Using custom AMI for EC2 deployment')
  amiIdParameterPath = buildHostAmiIdNameParameterPath
} else {
  amiIdParameterPath = defaultAmiIdParameterPath
}
const instanceClassString: string = app.node.tryGetContext('instanceClass');
if ( instanceClassString === 'm7a' ) {
  instanceClass = InstanceClass.M7A
  instanceSize = InstanceSize.XLARGE48METAL
} else {
  instanceClass = InstanceClass.M6A
  instanceSize = InstanceSize.METAL
}

new ImageBuilderStack(app, applicationName+'ImageBuilderStack'+regionCode.toUpperCase(), {
  env: { account: account, region: region },
  stackName: stackNamePrefix+'-image-builder-'+regionCode,
  owner: owner,
  applicationName: applicationName,
  amiIdParameterPath: amiIdParameterPath,
  eksAmiIdParameterPath: eksAmiIdParameterPath,
  instanceTypes: ['m7a.48xlarge','m6a.48xlarge','m7a.32xlarge','m6a.32xlarge','m7a.24xlarge','m6a.24xlarge','m7a.16xlarge','m6a.16xlarge'],
  buildHostAmiIdNameParameterPath: buildHostAmiIdNameParameterPath,
  buildEksHostAmiIdNameParameterPath: buildEksHostAmiIdNameParameterPath
})

const compute = new ComputeStack(app, applicationName+'ComputeStack'+regionCode.toUpperCase(), {
  env: { account: account, region: region },
  stackName: stackNamePrefix+'-bare-metal-'+regionCode,
  owner: owner,
  applicationName: applicationName,
  hostName: 'bare-metal',
  amiIdParameterPath: amiIdParameterPath,
  instanceSize: instanceSize,
  instanceClass: instanceClass,
});
NagSuppressions.addStackSuppressions(compute, [
  { id: 'AwsSolutions-IAM5', reason: 'Suppress all AwsSolutions-IAM5 findings: keep it simple for code sample' },
]);
