// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// # SPDX-License-Identifier: MIT-0
import * as cdk from 'aws-cdk-lib';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import { Construct } from 'constructs';
import { NagSuppressions } from 'cdk-nag';

interface ComputeStackProps extends cdk.StackProps {
    applicationName: string;
    stackName: string;
    owner: string;
    hostName: string
    amiIdParameterPath: string;
    instanceSize: ec2.InstanceSize;
    instanceClass: ec2.InstanceClass;
}

export class ComputeStack extends cdk.Stack {
    
    getAmi(amiIdParameterPath: string): ec2.IMachineImage {
        return ec2.MachineImage.fromSsmParameter(amiIdParameterPath, { cachedInContext: true });
    }
    
    getRegionCode(regionName: string): string {
        const regionNameArray = regionName.split("-")
        const regionCode = regionNameArray[0].slice(0,2)+regionNameArray[1].slice(0,1)+regionNameArray[2].slice(0,1);
        return regionCode;
    };
    
    constructor(scope: Construct, id: string, props: ComputeStackProps) {
        super(scope, id, props);
        
        const stackName = props.stackName;
        const applicationName = props.applicationName;
        const owner = props.owner;
        const amiId = this.getAmi(props.amiIdParameterPath);
        const vpc = ec2.Vpc.fromLookup(this, 'DefaultVpc', {
            isDefault: true,
        });
        const subnetIndex: number = this.node.tryGetContext('subnetIndex');
        
        const ebsRootVolume120GB = ec2.BlockDeviceVolume.ebs(120, {
            encrypted: true,
            volumeType: ec2.EbsDeviceVolumeType.GP3
        });
        
        // Add tags to all constructs in the stack
        cdk.Tags.of(this).add('Owner', owner);
        cdk.Tags.of(this).add('CreatedByCdkStack', stackName);
        cdk.Tags.of(this).add('ApplicationName', applicationName);
        
        const cloudWatchAgentPutLogsRetention = new iam.Policy(this, 'CwaPutLogsRetention', {
            statements: [
                new iam.PolicyStatement({
                    effect: iam.Effect.ALLOW,
                    actions: ['logs:PutRetentionPolicy'],
                    resources: ['*']
                })
            ],
        });
        
        const ec2Role = new iam.Role(this, 'Ec2Role', {
            assumedBy: new iam.ServicePrincipal('ec2.amazonaws.com')
        });
        ec2Role.addManagedPolicy(iam.ManagedPolicy.fromAwsManagedPolicyName('AmazonSSMManagedInstanceCore'));
        ec2Role.addManagedPolicy(iam.ManagedPolicy.fromAwsManagedPolicyName('CloudWatchAgentServerPolicy'));
        ec2Role.attachInlinePolicy(cloudWatchAgentPutLogsRetention);
        NagSuppressions.addResourceSuppressions(ec2Role, [
            { id: 'AwsSolutions-IAM4', reason: 'Suppress all AwsSolutions-IAM4 on the role' },
        ],true);


        // UserData
        const multipartUserData = new ec2.MultipartUserData();
        const commandsUserData = ec2.UserData.forLinux();
        multipartUserData.addUserDataPart(commandsUserData, ec2.MultipartBody.SHELL_SCRIPT, true);
        commandsUserData.addCommands('apt update');
        commandsUserData.addCommands('apt upgrade');
        
        // Launch template
        const instanceTemplate = new ec2.LaunchTemplate(this, 'InstancesTemplate', {
            machineImage: amiId,
            role: ec2Role,
            blockDevices: [{
                deviceName: '/dev/sda1', //'/dev/xvda', // Naming is very peaky here, https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/device_naming.html
                volume: ebsRootVolume120GB
            }],
            detailedMonitoring: true, // https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/using-cloudwatch-new.html
            requireImdsv2: true,
            httpPutResponseHopLimit: 1,
            instanceMetadataTags: true,
            userData: multipartUserData,
            spotOptions: {
                interruptionBehavior: ec2.SpotInstanceInterruption.STOP,
                requestType: ec2.SpotRequestType.PERSISTENT,
                validUntil: cdk.Expiration.after(cdk.Duration.days(365)), // Default is 7 days
            },
        });
        
        const securityGroup = new ec2.SecurityGroup(this, 'securityGroup', {
            vpc: vpc,
            description: props.hostName+' security group',
            allowAllOutbound: true,
            allowAllIpv6Outbound: true,
            securityGroupName: applicationName+props.hostName+'-instances-sg',
        });

        const instance = new ec2.CfnInstance(this, 'Instance-0'.toString(), {
            instanceType: ec2.InstanceType.of(props.instanceClass, props.instanceSize).toString(),
            networkInterfaces: [
                {
                    deviceIndex: '0',
                    associatePublicIpAddress: true,
                    deleteOnTermination: true,
                    groupSet: [securityGroup.securityGroupId],
                    subnetId: vpc.selectSubnets({ subnetType: ec2.SubnetType.PUBLIC }).subnetIds[subnetIndex], // This selects the subnet
                },
            ],
            tags: [{
                key: 'Name',
                value: props.hostName+'-0'.toString()+'-'+applicationName,
            },
            {
                key: 'HostName',
                value: props.hostName+'-0'.toString()
            }],
            launchTemplate: {
                version: instanceTemplate.latestVersionNumber,
                launchTemplateId: instanceTemplate.launchTemplateId
            }
        });
        NagSuppressions.addResourceSuppressions(instance, [
            { id: 'AwsSolutions-EC28', reason: 'No detailed monitoring needed' },
            { id: 'AwsSolutions-EC29', reason: 'No need to use an ASG for this scenario. And the instance can be terminated' },
        ]);
    };
}
