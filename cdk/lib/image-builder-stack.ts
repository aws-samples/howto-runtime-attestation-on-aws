// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// # SPDX-License-Identifier: MIT-0
import * as cdk from 'aws-cdk-lib';
import * as imagebuilder from 'aws-cdk-lib/aws-imagebuilder';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as topic from 'aws-cdk-lib/aws-sns';
import * as ssm from 'aws-cdk-lib/aws-ssm';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as subscription from 'aws-cdk-lib/aws-sns-subscriptions';
import * as kms from 'aws-cdk-lib/aws-kms';
import * as fs from 'fs';
import * as path from 'path';
import { Construct } from 'constructs';
import { NagSuppressions } from 'cdk-nag';

interface ImageBuilderStackProps extends cdk.StackProps {
    applicationName: string;
    stackName: string;
    owner: string;
    amiIdParameterPath: string;
    eksAmiIdParameterPath: string;
    instanceTypes: string[];
    buildHostAmiIdNameParameterPath: string;
    buildEksHostAmiIdNameParameterPath: string;
}

export class ImageBuilderStack extends cdk.Stack {
    readonly latestAmiIdPrefix: string;

    createDistributionConfiguration(namePrefix: string, region: string, name: string): imagebuilder.CfnDistributionConfiguration {
        const distributionConfiguration = new imagebuilder.CfnDistributionConfiguration(this, 'DistributionConfiguration'+name, {
            distributions: [{
                region: region,
                amiDistributionConfiguration: {
                    Description: "AMI created by ImageBuilder",
                    Name: namePrefix+'-{{ imagebuilder:buildDate }}',
                    AmiTags: {
                        CreatedBy: 'EC2ImageBuilder',
                        Name: namePrefix+'-{{ imagebuilder:buildDate }}'
                    },
                    //TargetAccountIds: [cdk.Stack.of(this).account], // To be very explicit
                },
            }],
            name: name,
        });
        return distributionConfiguration;
    }
    
    //createInfrastructureConfiguration(instanceProfileRef: string, arch: string, instanceTypes: string[], notificationTopicArn: string, logBucketName: string, prefixString: string): imagebuilder.CfnInfrastructureConfiguration {
    createInfrastructureConfiguration(instanceProfileRef: string, arch: string, instanceTypes: string[], notificationTopicArn: string, prefixString: string): imagebuilder.CfnInfrastructureConfiguration {
        const cfnInfrastructureConfiguration = new imagebuilder.CfnInfrastructureConfiguration(this, prefixString+'SevSnpInfrastructureConfiguration'+arch, {
            instanceProfileName: instanceProfileRef,
            name: prefixString+'Infrastructure'+arch,
            instanceTypes: instanceTypes,
            terminateInstanceOnFailure: false, // Remove in case of issue
            snsTopicArn: notificationTopicArn,
        });
        return cfnInfrastructureConfiguration;
    }

    constructor(scope: Construct, id: string, props: ImageBuilderStackProps) {
        super(scope, id, props);

        const stackName = props.stackName;
        const applicationName = props.applicationName;
        const owner = props.owner;
        const parentImage = ec2.MachineImage.fromSsmParameter(props.amiIdParameterPath);
        const parentEksImage = ec2.MachineImage.fromSsmParameter(props.eksAmiIdParameterPath);
        const buildHostAmiIdNameParameterPath = props.buildHostAmiIdNameParameterPath;
        const buildEksHostAmiIdNameParameterPath = props.buildEksHostAmiIdNameParameterPath;
        const instanceTypes = props.instanceTypes;
        
        // Add tags to all constructs in the stack
        cdk.Tags.of(this).add('Owner', owner);
        cdk.Tags.of(this).add('CreatedByStack', stackName);
        cdk.Tags.of(this).add('ApplicationName', applicationName);

        // Instance Profile and role for EC2 instance being used by EC2 Image Builder
        const ec2Role = new iam.Role(this, 'Role', {
            assumedBy: new iam.ServicePrincipal('ec2.amazonaws.com'),
            description: 'Role used by the instance profile required by EC2 Image Builder',
        });
        const instanceProfile = new iam.CfnInstanceProfile(this, 'ImageBuilderCfnInstanceProfile', {
            roles: [ec2Role.roleName],
        });
        // According to https://docs.aws.amazon.com/imagebuilder/latest/userguide/image-builder-setting-up.html
        ec2Role.addManagedPolicy(iam.ManagedPolicy.fromAwsManagedPolicyName('EC2InstanceProfileForImageBuilder'));
        //ec2Role.addManagedPolicy(iam.ManagedPolicy.fromAwsManagedPolicyName('EC2InstanceProfileForImageBuilderECRContainerBuilds'));
        ec2Role.addManagedPolicy(iam.ManagedPolicy.fromAwsManagedPolicyName('AmazonSSMManagedInstanceCore'));
        NagSuppressions.addResourceSuppressions(ec2Role, [
            { id: 'AwsSolutions-IAM4', reason: 'Suppress all AwsSolutions-IAM4 on the role' },
        ],true);

        // Image Builder Deployment
        const arch = 'SevSnp';
        const name = 'ImageBuilder-'+arch;
        const namePrefix = name+'-Ubuntu-Ec2';
        const eksNamePrefix = name+'-Ubuntu-EKS';
        // See https://docs.aws.amazon.com/imagebuilder/latest/userguide/integ-sns.html#integ-sns-encrypted
        const imageBuilderArnPrincipal = new iam.ArnPrincipal('arn:aws:iam::'+cdk.Stack.of(this).account+':role/aws-service-role/imagebuilder.amazonaws.com/AWSServiceRoleForImageBuilder');
        const snsKey = new kms.Key(this,'SnsKey',{
            enableKeyRotation: true,
            pendingWindow: cdk.Duration.days(7),
            alias: 'SevSnpImageBuilderSnsKey'
        });
        // See https://docs.aws.amazon.com/imagebuilder/latest/userguide/integ-sns.html#integ-sns-encrypted
        snsKey.grant(
            imageBuilderArnPrincipal,
            'kms:GenerateDataKey*',
            'kms:Decrypt'
        );
        const notificationTopicHost = new topic.Topic(this,"NotificationTopicHost",{
            topicName: 'SevSnpImageBuilderNotificationsHost',
            masterKey: snsKey,
        });
        const notificationTopicEksHost = new topic.Topic(this,"NotificationTopicEksHost",{
            topicName: 'SevSnpImageBuilderNotificationsEksHost',
            masterKey: snsKey,

        });
        const infrastructureConfigurationHost = this.createInfrastructureConfiguration(instanceProfile.ref, arch, instanceTypes, notificationTopicHost.topicArn, 'Ec2');
        infrastructureConfigurationHost.addDependency(instanceProfile);
        const infrastructureConfigurationEksHost = this.createInfrastructureConfiguration(instanceProfile.ref, arch, instanceTypes, notificationTopicEksHost.topicArn, 'Eks');
        infrastructureConfigurationEksHost.addDependency(instanceProfile);

        const basicsComponentUbuntuData = fs.readFileSync(path.join('imagebuilder/components/ubuntu/basics.yaml'), 'utf-8');
        const basicsComponentUbuntu = new imagebuilder.CfnComponent(this, 'BasicsComponentUbuntu', {
            name: 'Basic packages',
            platform: 'Linux',
            version: '0.0.1',
            changeDescription: 'Initial version',
            description: 'Install basic needed packages (e.g. jq)',
            data: basicsComponentUbuntuData
        });
        const eksBasicsComponentUbuntuData = fs.readFileSync(path.join('imagebuilder/components/ubuntu/eksBasics.yaml'), 'utf-8');
        const eksBasicsComponentUbuntu = new imagebuilder.CfnComponent(this, 'EksBasicsComponentUbuntu', {
            name: 'Basic packages for EKS image',
            platform: 'Linux',
            version: '0.0.1',
            changeDescription: 'Initial version',
            description: 'Install basic needed packages for EKS image',
            data: eksBasicsComponentUbuntuData
        });
        const sevSnpUtilsComponentUbuntuData = fs.readFileSync(path.join('imagebuilder/components/ubuntu/sevsnputils.yaml'), 'utf-8');
        const sevSnpUtilsComponentUbuntu = new imagebuilder.CfnComponent(this, 'SevSnpUtilsUbuntu', {
            name: 'SevSnp utils packages',
            platform: 'Linux',
            version: '0.0.3',
            changeDescription: 'Initial version',
            description: 'Install AWS needed packages (e.g. ssm)',
            data: sevSnpUtilsComponentUbuntuData
        });
        const kernelComponentUbuntuData = fs.readFileSync(path.join('imagebuilder/components/ubuntu/kernel.yaml'), 'utf-8');
        const kernelComponentUbuntu = new imagebuilder.CfnComponent(this, 'KernelComponentUbuntu', {
            name: 'kernel',
            platform: 'Linux',
            version: '0.0.5',
            changeDescription: 'Initial version',
            description: 'Install custom kernel that supports SEV-SNP',
            data: kernelComponentUbuntuData
        });
        const qemuOvmfComponentUbuntuData = fs.readFileSync(path.join('imagebuilder/components/ubuntu/qemu_ovmf.yaml'), 'utf-8');
        const qemuOvmfComponentUbuntu = new imagebuilder.CfnComponent(this, 'QemuOvmfComponentUbuntu', {
            name: 'qemu_ovmf',
            platform: 'Linux',
            version: '0.0.6',
            changeDescription: 'Initial version',
            description: 'Install custom QEMU and OVMF that support SEV-SNP',
            data: qemuOvmfComponentUbuntuData
        });
        const cleanUpComponentUbuntuData = fs.readFileSync(path.join('imagebuilder/components/ubuntu/cleanup.yaml'), 'utf-8');
        const cleanUpComponentUbuntu = new imagebuilder.CfnComponent(this, 'CleanUpComponentUbuntu', {
            name: 'clean-up',
            platform: 'Linux',
            version: '0.0.2',
            changeDescription: 'Initial version',
            description: 'Clean up /usr/local/src and more if needed',
            data: cleanUpComponentUbuntuData
        });

        const imageRecipe = new imagebuilder.CfnImageRecipe(this, 'HostImageRecipe', {
            name: 'UbuntuSevSnpHostImage',
            description: 'Host Image Recipe for SEV-SNP with Ubuntu',
            version: '0.0.18',
            components: [
                { componentArn: basicsComponentUbuntu.attrArn },
                { componentArn: sevSnpUtilsComponentUbuntu.attrArn },
                { componentArn: qemuOvmfComponentUbuntu.attrArn },
                {
                    componentArn: kernelComponentUbuntu.attrArn,
                    parameters: [
                        { name: 'VERSION', value: ['6.11.5'] },
                        { name: 'KERNEL-REPO', value: ['https://git.kernel.org/pub/scm/linux/kernel/git/stable/linux.git/'] }
                    ],
                },
                { componentArn: cleanUpComponentUbuntu.attrArn },
            ],
            parentImage: parentImage.getImage(this).imageId,
            additionalInstanceConfiguration: {
                systemsManagerAgent: {
                    uninstallAfterBuild: false,
                },
            },
            blockDeviceMappings: [{
                    // Only one block device
                    deviceName: "/dev/sda1",
                    ebs: {
                        volumeType: "gp3",
                        volumeSize: 48,
                        deleteOnTermination: true,
                        encrypted: true,
                    }
                }
            ]
        });

        const eksImageRecipe = new imagebuilder.CfnImageRecipe(this, 'EksHostImageRecipe', {
            name: 'UbuntuSevSnpEksHostImage',
            description: 'EKS Host Image Recipe for SEV-SNP with Ubuntu',
            version: '0.0.18',
            components: [
                { componentArn: basicsComponentUbuntu.attrArn },
                { componentArn: eksBasicsComponentUbuntu.attrArn },
                { componentArn: sevSnpUtilsComponentUbuntu.attrArn },
                { componentArn: qemuOvmfComponentUbuntu.attrArn },
                {
                    componentArn: kernelComponentUbuntu.attrArn,
                    parameters: [
                        { name: 'VERSION', value: ['6.11.5'] },
                        { name: 'KERNEL-REPO', value: ['https://git.kernel.org/pub/scm/linux/kernel/git/stable/linux.git/'] }
                    ],
                },
                { componentArn: cleanUpComponentUbuntu.attrArn },
            ],
            parentImage: parentEksImage.getImage(this).imageId,
            additionalInstanceConfiguration: {
                systemsManagerAgent: {
                    uninstallAfterBuild: false,
                },
            },
            blockDeviceMappings: [{
                    // Only one block device
                    deviceName: "/dev/sda1",
                    ebs: {
                        volumeType: "gp3",
                        volumeSize: 48,
                        deleteOnTermination: true,
                        encrypted: true,
                    }
                }
            ]
        });

        const distributionConfiguration = this.createDistributionConfiguration(namePrefix, cdk.Stack.of(this).region, name+'Ec2');
        const eksDistributionConfiguration = this.createDistributionConfiguration(eksNamePrefix, cdk.Stack.of(this).region, name+'Eks');
        const imageTestsConfigurationProperty: imagebuilder.CfnImagePipeline.ImageTestsConfigurationProperty = {
            imageTestsEnabled: false,
            timeoutMinutes: 60, // 60 is the minimum
        };  
        
        new imagebuilder.CfnImagePipeline(this, 'ImagePipelineUbuntuSevSnpHostEc2', {
            name: 'Image pipeline for Ubuntu SEV-SNP Host image on EC2',
            description: 'Ubuntu AMI with SEV-SNP host support for EC2',
            infrastructureConfigurationArn: infrastructureConfigurationHost.attrArn,
            imageRecipeArn: imageRecipe.attrArn,
            distributionConfigurationArn: distributionConfiguration.attrArn,
            status: 'ENABLED',
            enhancedImageMetadataEnabled: false,  // False needed if using PVE reporting, see https://docs.aws.amazon.com/imagebuilder/latest/userguide/troubleshooting.html#ts-ssm-mult-inventory
            imageTestsConfiguration: imageTestsConfigurationProperty
        });

        new imagebuilder.CfnImagePipeline(this, 'ImagePipelineUbuntuSevSnpHostEks', {
            name: 'Image pipeline for Ubuntu SEV-SNP Host image on EKS',
            description: 'Ubuntu EKS AMI with SEV-SNP host support (for EKS)',
            infrastructureConfigurationArn: infrastructureConfigurationEksHost.attrArn,
            imageRecipeArn: eksImageRecipe.attrArn,
            distributionConfigurationArn: eksDistributionConfiguration.attrArn,
            status: 'ENABLED',
            enhancedImageMetadataEnabled: false,  // False needed if using PVE reporting, see https://docs.aws.amazon.com/imagebuilder/latest/userguide/troubleshooting.html#ts-ssm-mult-inventory
            imageTestsConfiguration: imageTestsConfigurationProperty
        });

        // Lambda to store the latest AMI in parameter store
        const latestUbuntuSevSnpHostId = new ssm.StringParameter(this, 'latestUbuntuSevSnpHostId', {
            description: 'Latest Ubuntu SEV-SNP Host AMI ID for EC2',
            parameterName: buildHostAmiIdNameParameterPath,
            dataType: ssm.ParameterDataType.TEXT,
            stringValue: 'n/a', // This is a dummy value, will be filled in by the lambda below
        });
        const latestUbuntuSevSnpEksHostId = new ssm.StringParameter(this, 'latestUbuntuSevSnpEksHostId', {
            description: 'Latest Ubuntu SEV-SNP Host AMI ID for EKS',
            parameterName: buildEksHostAmiIdNameParameterPath,
            dataType: ssm.ParameterDataType.TEXT,
            stringValue: 'n/a', // This is a dummy value, will be filled in by the lambda below
        });
        const functionRecordUbuntuSevSnpHostId = new lambda.Function(this, 'recordUbuntuSevSnpHostId', {
            description: 'Store Ubuntu SEV-SNP Host AMI ID',
            retryAttempts: 2,
            memorySize: 128,
            timeout: cdk.Duration.seconds(5),
            architecture: lambda.Architecture.ARM_64,
            code: lambda.Code.fromAsset('lambda/'),
            handler: 'record_ami_id.main',
            runtime: lambda.Runtime.PYTHON_3_12,
            environment: {
                region: cdk.Stack.of(this).region,
                topic_arch_any: notificationTopicHost.topicName,
                parameter_arch_any: latestUbuntuSevSnpHostId.parameterName,
            },
        });
        notificationTopicHost.addSubscription(new subscription.LambdaSubscription(functionRecordUbuntuSevSnpHostId));
        latestUbuntuSevSnpHostId.grantRead(functionRecordUbuntuSevSnpHostId);
        latestUbuntuSevSnpHostId.grantWrite(functionRecordUbuntuSevSnpHostId);
        NagSuppressions.addResourceSuppressions(functionRecordUbuntuSevSnpHostId, [
            { id: 'AwsSolutions-IAM4', reason: 'Using AWS managed policy because this is the default CDK setting' },
        ],true);
        const functionRecordUbuntuSevSnpEksHostId = new lambda.Function(this, 'recordUbuntuSevSnpEksHostId', {
            description: 'Store Ubuntu SEV-SNP EKS Host AMI ID',
            retryAttempts: 2,
            memorySize: 128,
            timeout: cdk.Duration.seconds(5),
            architecture: lambda.Architecture.ARM_64,
            code: lambda.Code.fromAsset('lambda/'),
            handler: 'record_ami_id.main',
            runtime: lambda.Runtime.PYTHON_3_12,
            environment: {
                region: cdk.Stack.of(this).region,
                topic_arch_any: notificationTopicEksHost.topicName,
                parameter_arch_any: latestUbuntuSevSnpEksHostId.parameterName,
            },
        });
        notificationTopicEksHost.addSubscription(new subscription.LambdaSubscription(functionRecordUbuntuSevSnpEksHostId));
        latestUbuntuSevSnpEksHostId.grantRead(functionRecordUbuntuSevSnpEksHostId);
        latestUbuntuSevSnpEksHostId.grantWrite(functionRecordUbuntuSevSnpEksHostId);
        NagSuppressions.addResourceSuppressions(functionRecordUbuntuSevSnpEksHostId, [
            { id: 'AwsSolutions-IAM4', reason: 'Using AWS managed policy because this is the default CDK setting' },
        ],true);
    }
}
