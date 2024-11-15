# Runtime Attestation

This repository provides artefacts to build and deploy an Amazon machine image (AMI) with SEV-SNP support. This image is meant to be deployed on a bare-metal host with SEV-SNP support (M6A or M7A). The AMI comprises a host OS with kernel support and patched KVM/OVMF (from the [AMDSEV repository](https://github.com/AMDESE/AMDSEV.git)). The bare-metal EC2 host can be used standalone or attached to a Kubernetes cluster. With the standalone EC2, you can then launch a guest OS.

Standard attestation workflow is validated.

This repository provides sample codes for two build and deployment options. With Option 1, you start an EC2 bare-metal instance via the console and follow the build instructions in this README. With Options 2, you use the two CDK stacks. The first stack creates an EC2 Image Builder pipeline that builds all the software dependencies and creates an AMI. This first stack also builds a custom [Ubuntu image for an EKS worker node](https://cloud-images.ubuntu.com/docs/aws/eks/) with SEV-SNP support. The second stack launches an EC2 bare-metal instance, using the pre-build AMI, with a [spot persistent request](https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/spot-requests.html) to keep cost to a minimum. You can also decide to launch the instance with any other AMI (useful to experiment).

Work in progress: three next steps are (in no specific order)
1. Consider Linux distributions beyond Ubuntu
2. Use upstream QEMU and OVMF rather the versions supplied via the [AMDSEV repository](https://github.com/AMDESE/AMDSEV.git)
3. Add instructions to deploy the custom [Ubuntu image for an EKS worker node](https://cloud-images.ubuntu.com/docs/aws/eks/) with EKS

As SEV-SNP support trickles down in various distributions, getting it all setup will become simpler.

Just reach out for/to help ;-)

_Warning_: using bare-metal instances generate costs. Make sure to terminate or stop the instance when not in use.

## Status

| m6a | m7a | OS | Custom Host Kernel | AMDSEV QEMU and OVMF | Standard attestation workflow | Rust version in Guest |
|---|---|---|---|---|---|---|
| :white_check_mark:  | :white_check_mark:  | Ubuntu [Jammy 1.31 for EKS](https://cloud-images.ubuntu.com/docs/aws/eks/) | [stable 6.11.5](https://git.kernel.org/pub/scm/linux/kernel/git/stable/linux.git/tree/?h=v6.11.5) | [snp-latest d9404d5](https://github.com/AMDESE/AMDSEV/commit/d9404d58c0b6cc7c8b6c8c2ad190726acebdfde9) | SEV-SNP Validated :white_check_mark: / [EKS workder node](https://docs.aws.amazon.com/eks/latest/userguide/launch-node-ubuntu.html) :white_check_mark: | |
| :white_check_mark:  | :white_check_mark: | Ubuntu 24.04.1 LTS | [stable 6.11.5](https://git.kernel.org/pub/scm/linux/kernel/git/stable/linux.git/tree/?h=v6.11.5) | [snp-latest d9404d5](https://github.com/AMDESE/AMDSEV/commit/d9404d58c0b6cc7c8b6c8c2ad190726acebdfde9) | Validated :white_check_mark: | |
| :white_check_mark:  | :white_check_mark: | Ubuntu 24.04.1 LTS | [mainline 6.11](https://git.kernel.org/pub/scm/linux/kernel/git/torvalds/linux.git/tag/?h=v6.11) | [snp-latest d9404d5](https://github.com/AMDESE/AMDSEV/commit/d9404d58c0b6cc7c8b6c8c2ad190726acebdfde9) | Validated :white_check_mark: | |

The :white_check_mark: under the m6a and m7a column means that the output of `snphost` shows `[ PASS ]` for all lines. Validated for Standard attestation workflow means that it could be replicated according to the instructions in the Section _Standard Attestion_ below (and that the output of `snpguest` shows shows `[ PASS ]`).

The instructions in this repo will be updated as the software components (QEMU, etc) become readily available via distribution package managers.

## How to check for Regions with m6a or m7a Metal Instances?

You can run the `get_metal_locations.sh` shell script located at the root of this repository. This script assumes that you have installed the [AWS Command Line Inteface](https://aws.amazon.com/cli/) (CLI).

# Option 1: Deploy the Infrastructure via the AWS Console

Using the console, deploy a bare-metal m6a or m7a instance (metal instance), with an Ubuntu 24.04 LTS AMI. You can use spot instances to mininize cost.

## Build SEV-SNP Support with Ubuntu
Get dependencies in place
```bash
sudo apt update
sudo apt upgrade -y
sudo apt install -y build-essential amazon-ec2-utils
sudo apt install -y tmux git rsync # For eks image
sudo apt install -y msr-tools libssl-dev pkg-config
sudo curl --proto '=https' --tlsv1.3 -sSf https://sh.rustup.rs | sh -s -- -y
. "$HOME/.cargo/env"
mkdir ~/src
```
I recommend you use a `tmux` session.
Build `sevctl`. It reports support for SEV-SNP is missing (with a kernel 6.8 on Ubuntu 24.04 at this time of writing)
```bash
cd ~/src
git clone https://github.com/virtee/sevctl
cd sevctl
cargo build -r
# cargo install --path .
sudo target/release/sevctl ok
```
Build `snphost`. It reports issues with SEV-ES and SEV-SNP
```bash
cd ~/src
git clone https://github.com/virtee/snphost
cd snphost
cargo build -r
# cargo install --path .
sudo target/release/snphost ok
```

### Build a new kernel to get support for SEV-SNP
If your current kernel is not 6.11 or higher, you need to build a new kernel to get SEV-SNP support.
First step is to install Dracut in order to defer the CCP module from loading and then to have the SEV metedata written to a file in the root directory. That's because the Nitro Security chip will prevent writing to firmware.
```bash
sudo apt install dracut -y
sudo tee -a /etc/dracut.conf.d/20-omit-ccp.conf <<EOF
omit_drivers+=" ccp "
EOF
sudo dracut --force
sudo tee -a /etc/modprobe.d/60-ccp.conf <<EOF
options ccp init_ex_path=/SEV_metadata
EOF
```
And update the kernel cmdline
```bash
# Update cmdline: add mem_encrypt=on kvm_amd.sev=1 iommu=nopt to GRUB_CMDLINE_LINUX_DEFAULT in /etc/default/grub.d/50-cloudimg-settings.cfg
sudo sed 's/\(GRUB_CMD.*\)"/\1 mem_encrypt=on kvm_amd.sev=1 iommu=nopt"/' -i /etc/default/grub.d/50-cloudimg-settings.cfg
grep GRUB_CMD /etc/default/grub.d/50-cloudimg-settings.cfg # To validate
sudo update-grub
sudo grep sev /boot/grub/grub.cfg # Check
```

Let's now build the kernel. Install prerequisites
```bash
sudo apt install -y libncurses-dev flex bison libelf-dev libudev-dev libpci-dev libiberty-dev libelf-dev debhelper-compat dwarves ccache
```
Choose the option that makes sense for you.
#### Download Stable Kernel 6.11.5

```bash
cd ~/src
git clone https://git.kernel.org/pub/scm/linux/kernel/git/stable/linux.git/
cd linux
VERSION=6.11.5
git tag -l v${VERSION}*
git checkout tags/v${VERSION}
```

#### Or Download Mainline Kernel 6.11

```bash
cd ~/src
git clone https://git.kernel.org/pub/scm/linux/kernel/git/torvalds/linux.git #git clone https://kernel.googlesource.com/pub/scm/linux/kernel/git/torvalds/linux.git
cd linux
VERSION=6.11
git tag -l v${VERSION}*
git checkout tags/v${VERSION} #git checkout tags/v6.11-rc5
```

#### Build and Install the Kernel
```bash
cp -v /boot/config-$(uname -r) .config
scripts/config --disable CONFIG_BASE_SMALL
scripts/config --disable CONFIG_ANDROID_BINDER_IPC
scripts/config --disable CONFIG_ANDROID_BINDERFS
make olddefconfig
scripts/config --set-str SYSTEM_TRUSTED_KEYS ""
scripts/config --set-str SYSTEM_REVOCATION_KEYS ""
scripts/config --enable CONFIG_DEBUG_INFO_NONE
scripts/config --disable CONFIG_DEBUG_INFO
scripts/config --disable DEBUG_INFO_DWARF_TOOLCHAIN_DEFAULT
scripts/config --disable CONFIG_DEBUG_INFO_DWARF4
scripts/config --disable CONFIG_DEBUG_INFO_DWARF5
scripts/config --disable CONFIG_DEBUG_INF_BTF
make clean
# Faster, only necessary binaries.
make bindeb-pkg -j"$(nproc)" LOCALVERSION=-sev-snp-"$(dpkg --print-architecture)" KDEB_PKGVERSION="$(make kernelversion)-1"
```
(Useful references: [ref](https://kernel-team.pages.debian.net/kernel-handbook/ch-common-tasks.html#s-kernel-org-package), [ref](https://askubuntu.com/questions/1329538/compiling-kernel-5-11-11-and-later))
And now install the packages
```bash
cd ~/src
sudo dpkg -i linux-*-${VERSION}*64_6* # Image and header
```

#### Rebot (or kexec)

Reboot the instance to start with the new kernel. From the `cdk` directory (not on the instance), you can use 
```bash
bin/reboot-instance.sh $REGION
```
Note that rebooting a bare-metal instance takes some minutes. Go have a coffee. The status check in the console will temporarily fail. If the instance is not available after an hour, something failed. Else, once available, log back in and check you run the latest kernel

Alternatively, you can `kexec` into the new kernel (look at the output over the EC2 serial console). You can get the command-line parameters from `cat /proc/cmdline`
```bash
sudo apt install -y kexec-tools
# Adapt accordingly
sudo kexec -l /boot/vmlinuz-${VERSION}-sev-snp-amd64 --append="root=PARTUUID=37df32be-d645-4334-8fae-e0cee60a7b2d ro console=tty1 console=ttyS0 nvme_core.io_timeout=4294967295  mem_encrypt=on kvm_amd.sev=1 iommu=nopt panic=-1" --initrd=/boot/initrd.img-${VERSION}-sev-snp-amd64
sudo kexec -e
```

## Validate the Host SEV-SNP Support

Now that you have an up-and-running EC2 instance, you can validate SEV-SNP support.
```bash
uname -a # Should show the latest kernel, for example 6.11 in this case
cat /sys/module/kvm_amd/parameters/sev_snp # Should show y
sudo dmesg | grep -i -E "(ccp|sev)"
```
The last command shows SEV unusable, but SEV-ES and SEV-SNP enabled. And you can validate with the output of `sevctl ok` and `snphost ok`, e.g.
```bash
sudo src/sevctl/target/release/sevctl ok
```
should show
```console
[ PASS ] - AMD CPU
[ PASS ]   - Microcode support
[ PASS ]   - Secure Memory Encryption (SME)
[ PASS ]   - Secure Encrypted Virtualization (SEV)
[ PASS ]     - Encrypted State (SEV-ES)
[ PASS ]     - Secure Nested Paging (SEV-SNP)
[ PASS ]       - VM Permission Levels
[ PASS ]         - Number of VMPLs: 4
[ PASS ]     - Physical address bit reduction: 5
[ PASS ]     - C-bit location: 51
[ PASS ]     - Number of encrypted guests supported simultaneously: 509
[ PASS ]     - Minimum ASID value for SEV-enabled, SEV-ES disabled guest: 510
[ PASS ]     - SEV enabled in KVM: enabled
[ PASS ]     - SEV-ES enabled in KVM: enabled
[ PASS ]     - Reading /dev/sev: /dev/sev readable
[ PASS ]     - Writing /dev/sev: /dev/sev writable
[ PASS ]   - Page flush MSR: ENABLED
[ PASS ] - KVM supported: API version: 12
[ PASS ] - Memlock resource limit: Soft: 101016338432 | Hard: 101016338432
```
and
```bash
sudo src/snphost/target/release/snphost ok
```
should show
```console
[ PASS ] - AMD CPU
[ PASS ]   - Microcode support
[ PASS ]   - Secure Memory Encryption (SME)
[ PASS ]     - SME: Enabled in MSR
[ PASS ]   - Secure Encrypted Virtualization (SEV)
[ PASS ]     - Encrypted State (SEV-ES)
[ PASS ]       - SEV-ES INIT: Enabled
[ PASS ]     - SEV INIT: SEV is INIT, but not currently running a guest
[ PASS ]     - Secure Nested Paging (SEV-SNP)
[ PASS ]       - VM Permission Levels
[ PASS ]         - Number of VMPLs: 4
[ PASS ]       - SNP: Enabled in MSR
[ PASS ]       - SEV Firmware Version: Sev firmware version: 1.55
[ PASS ]       - SNP INIT: SNP is INIT
[ PASS ]     - Physical address bit reduction: 5
[ PASS ]     - C-bit location: 51
[ PASS ]     - Number of encrypted guests supported simultaneously: 509
[ PASS ]     - Minimum ASID value for SEV-enabled, SEV-ES disabled guest: 510
[ PASS ]     - Reading /dev/sev: /dev/sev readable
[ PASS ]     - Writing /dev/sev: /dev/sev writable
[ PASS ]   - Page flush MSR: ENABLED
[ PASS ] - KVM supported: API version: 12
[ PASS ]   - SEV enabled in KVM: enabled
[ PASS ]   - SEV-ES enabled in KVM: enabled
[ PASS ]   - SEV-SNP enabled in KVM: enabled
[ PASS ] - Memlock resource limit: Soft: 101016338432 | Hard: 101016338432
[ PASS ] - RMP table addresses: Addresses: 412852682752 - 416083345407
[ PASS ] - RMP INIT: RMP is INIT
[ PASS ] - Comparing TCB values: TCB versions match 

 Platform TCB version: 
TCB Version:
  Microcode:   213
  SNP:         20
  TEE:         0
  Boot Loader: 4
   
 Reported TCB version: 
TCB Version:
  Microcode:   213
  SNP:         20
  TEE:         0
  Boot Loader: 4
```
You might have to load the `msr` module if you see error message related to MSR.

## Build Host Capabilities: QEMU, OVMF

We use instructions from the `snp-latest` branch of https://github.com/AMDESE/AMDSEV.git
```bash
sudo apt install -y nasm uuid-dev ninja-build acpica-tools libslirp-dev libbpf-dev libcap-ng-dev libtasn1-6-dev libnuma-dev libusb-1.0-0-dev libkeyutils-dev libglib2.0-dev python3-venv python-is-python3 virtinst valgrind
sudo apt install -y libbzip3-dev
sudo apt -y install ovmf qemu-system # To get the dependencies
cd ~/src
git clone https://github.com/AMDESE/AMDSEV.git
cd AMDSEV
git checkout snp-latest
#./build.sh -h # To get detail
./build.sh qemu
git clone https://github.com/AMDESE/ovmf.git # Fix for https://github.com/AMDESE/AMDSEV/issues/244
cd ovmf
git checkout snp-latest
sed  's/subhook.git/edk2-subhook.git/' -i .gitmodules && sed  's/Zeex/tianocore/' -i .gitmodules
cd ..
./build.sh ovmf
#./build.sh kernel
sudo cp kvm.conf /etc/modprobe.d/
```
You can now jump to the *Guest Setup* Section below.

# Option 2: Deploy the Infrastructure via AWS CDK

The following deploys an Amazon EC2 bare-metal instance (m6a or m7a). The instance is deployed with a [spot persistent request](https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/spot-requests.html) to keep cost to a minimum. The instance is deployed in the default VPC, in the public subnet. It can be accessed via AWS Systems Manager [Session Manager](https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/connect-with-systems-manager-session-manager.html).

If not done already, install the [AWS Cloud Development Kit](https://docs.aws.amazon.com/cdk/v2/guide/getting_started.html) (CDK)

## Instal and Bootstrap the AWS CDK Environment

Before AWS CDK apps can be deployed in your AWS environment, you must provision preliminary resources. This process is called [bootstrapping](https://docs.aws.amazon.com/cdk/v2/guide/bootstrapping.html):

Clone the git repository, change directory to `cdk`, and bootstrap
```bash
REGION=$(aws configure get region)
echo Default AWS Region: ${REGION}
ACCOUNT=$(aws sts get-caller-identity --query "Account" --output text)
echo AWS Account number: ${ACCOUNT}
npm install # Install
cdk synth
APPLICATION=RuntimeAttestation
cdk bootstrap aws://${ACCOUNT}/${REGION} -t Application=${APPLICATION}
```
## Deploy the AWS Systems Manager Session Document

[Session Manager](https://docs.aws.amazon.com/systems-manager/latest/userguide/session-manager.html) is an AWS Systems Manager capability. We use Session Manager to securely access EC2 instances for development purpose and for interactive demo sessions. Session manager configuration is controlled by a [session document](https://docs.aws.amazon.com/systems-manager/latest/userguide/session-manager-schema.html). We deploy this session document before using Session manager

From the `cdk` directory, run the following command to create a session document from the `session_document.yaml` file:
```bash
REGION=$(aws configure get region)
echo Default AWS Region: ${REGION}
SESSION_DOCUMENT_NAME=SessionRegionalSettingsUbuntu
aws ssm create-document --content file://utils/ssm/session-document-ubuntu.yaml --document-type "Session" --name ${SESSION_DOCUMENT_NAME} --document-format YAML --region ${REGION}
```

## Deploy the CDK Application

This is a two steps process. First you deploy the EC2 Image Builder pipeline to build the custom AMI. Then you can deploy the EC2 instance. Hence, from the root of the `cdk` directory, type
```bash
cdk deploy RuntimeAttestationImageBuilderStackEUC1 --require-approval never
```
To trigger the build of the custom AMI, open the [AWS console for the EC2 Image Builder](https://console.aws.amazon.com/imagebuilder/home) service. Select the checkbox for the pipeline named *Image pipeline for Ubuntu SEV-SNP Host image on EC2*, and in the Action drop-down menu, select *Run pipeline*. Building the AMI takes about 20 minutes. Similarly, you can launch the pipeline for the EKS worker node image with the *Image pipeline for Ubuntu SEV-SNP Host image on EKS*.

When complete, deploy the AWS EC2 bare-metal _[spot](https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/using-spot-instances.html)_ instance. From the root of the directory, this will deploy an M6A instance
```bash
cdk deploy RuntimeAttestationComputeStackEUC1 --require-approval never -c useCustomAmi=true -c subnetIndex=0
```
Use `-c instanceClass=m7a` to deploy an M7A instance.
If you want to use the CDK application to deploy the AWS EC2 bare-metal instance with a default Ubuntu image, remove the `-c useCustomAmi=true` parameter.

## Connect to the Instance

From the root of the directory
```bash
cdk/bin/connect-to-intance-via-ssm-session.sh bare-metal-0
# Or cdk/bin/connect-to-intance-via-ssm-session.sh bare-metal-0 0 $REGION
```
You can follow the instructions above in the _Validate the Host SEV-SNP Support_ Section.

# Test the EKS Worker node

*This section will be improved*

Follow the instructions in [DEPLOY.md](eks/DEPLOY.md). These instructions create an EKS cluster and a managaed node-group with an M6A or M7A metal instance (using a spot deployment).

# Guest Setup

Create a guest operating system image. We use again Ubuntu. From the `~/src/AMDSEV` directory
```bash
cd ~/src/AMDSEV
wget -c https://releases.ubuntu.com/noble/ubuntu-24.04.1-live-server-amd64.iso
usr/local/bin/qemu-img create -f qcow2 img-ubuntu-2404.qcow2 42G
# Install Ubuntu
sudo ./launch-qemu.sh -hda img-ubuntu-2404.qcow2 -cdrom ubuntu-24.04.1-live-server-amd64.iso
```
Edit the menu-entry for `Try or Install Ubuntu Server` and make sure you have
```bash
set gfxpayload=text
linux /casper/vmlinuz console=tty0 console=ttyS0,115200n8 nosplash ---
initrd /casper/initrd
```
Now follow the installation process. Nothing special. Reboot at the end. Type C-c, or you might have to kill the QEMU process via SIGTERM (`sudo kill -SIGTERM $PID`). If you know how to automate this section, let me know.

## Test the Guest

```bash
sudo ./launch-qemu.sh -hda img-ubuntu-2404.qcow2 -sev-snp
```
Then, from the guest
```bash
sudo dmesg | grep -i snp
sudo dmesg | grep -i sev
sudo apt install -y build-essential
sudo curl --proto '=https' --tlsv1.3 -sSf https://sh.rustup.rs | sh -s -- -y
. "$HOME/.cargo/env"
mkdir -p ~/src
cd ~/src
git clone https://github.com/virtee/snpguest
cd snpguest
cargo build -r
sudo target/release/snpguest ok
```
The outcome of `snpguest` shows
```console
[ PASS ] - SEV: ENABLED
[ PASS ] - SEV-ES: ENABLED
[ PASS ] - SNP: ENABLED
[ PASS ] - Optional Features statuses:
[ PASS ]   - VTOM: DISABLED
[ PASS ]   - ReflectVC: DISABLED
[ PASS ]   - Restricted Injection: DISABLED
[ PASS ]   - Alternate Injection: DISABLED
[ PASS ]   - Debug Swap: DISABLED
[ PASS ]   - Prevent Host IBS: DISABLED
[ PASS ]   - SNP BTB Isolation: DISABLED
[ PASS ]   - VMPL SSS: DISABLED
[ PASS ]   - Secure TSE: DISABLED
[ PASS ]   - VMG Exit Parameter: DISABLED
[ PASS ]   - IBS Virtualization: DISABLED
[ PASS ]   - VMSA Reg Prot: DISABLED
[ PASS ]   - SMT Protection: DISABLED
```

##  Testing a New Kernel from the Host

If you want to reuse the kernel used for the host. On the host, in the directory hosting the kernel packages
```bash
python3 -m http.server
```
On the guest (change IP address of guest and kernel packages naming accordingly)
```bash
wget -c http://172.31.25.39:8000/linux-image-6.11.0-sev-snp-amd64_6.11.0-1_amd64.deb
wget -c http://172.31.25.39:8000/linux-headers-6.11.0-sev-snp-amd64_6.11.0-1_amd64.deb
# Install
sudo dpkg -i linux-*
```

## Further Useful Commands

```bash
cat /proc/cpuinfo | grep -i sev
sudo dmesg | grep -i -E "(ccp|sev)"
cat /sys/module/kvm_amd/parameters/sev
cat /sys/module/kvm_amd/parameters/sev_es
cat /sys/module/kvm_amd/parameters/sev_snp
echo "obase=2;$(sudo rdmsr -d 0xc0010010)" | bc
```

# Attestation Workflow

## Standard Attestion

See https://github.com/AMDESE/AMDSEV/issues/212#issuecomment-2064093286 for an overview

On the guest (assuming `Genoa` with M7A, use `Milan` with M6A)
```bash
GEN=Milan
gen=$(echo $GEN | tr '[:upper:]' '[:lower:]')
sudo ./snpguest report report.bin request-file.txt --random
sudo ./snpguest fetch ca -e vcek pem ${gen} certs/ # From the KDS, ark and ask
sudo ./snpguest fetch vcek pem ${gen} certs/ report.bin
sudo curl --proto '=https' --tlsv1.2 \
    -sSf https://kdsintf.amd.com/vcek/v1/${GEN}/cert_chain \
    -o ./vcek_cert_chain.pem
sudo openssl verify --CAfile ./vcek_cert_chain.pem certs/vcek.pem
sudo ./snpguest verify attestation certs/ report.bin
```

## Extended Attestation (Not Tested)

_Not supported_

See "Create cert-chain for SNP attestation" in https://github.com/kata-containers/kata-containers/blob/main/docs/how-to/how-to-run-kata-containers-with-SNP-VMs.md
```bash
mkdir /tmp/certs
snphost fetch vcek der /tmp/certs
snphost import /tmp/certs /opt/snp/cert_chain.cert
```
# Clean-up

This will clean-up in all regions
```bash
cdk destroy RuntimeAttestationComputeStack* --force true
bin/manage-metal-spot-requests.sh delete eu-central-1
cdk destroy RuntimeAttestationImageBuilderStack* --force true
bin/delete-image-builder-images.sh
```

# Credits

See https://www.youtube.com/watch?v=nwW9aLdcA4I&t=2099s
