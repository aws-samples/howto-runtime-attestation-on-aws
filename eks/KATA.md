
# Kata Container Deployment
We follow most of the instructions in this blog post: [Enhancing Kubernetes workload isolation and security using Kata Containers](https://aws.amazon.com/blogs/containers/enhancing-kubernetes-workload-isolation-and-security-using-kata-containers/). Note that these instructions will currently _not_ yield a working setup if you want to experiment with SEV-SNP: see [Test with SEV-SNP Support](#kata-sev-snp) instead below.

## Install Kata Runtime
```bash
kubectl apply -f https://raw.githubusercontent.com/kata-containers/kata-containers/main/tools/packaging/kata-deploy/kata-rbac/base/kata-rbac.yaml
kubectl apply -f https://raw.githubusercontent.com/kata-containers/kata-containers/main/tools/packaging/kata-deploy/kata-deploy/base/kata-deploy.yaml
kubectl -n kube-system wait --timeout=10m --for=condition=Ready -l name=kata-deploy pod
kubectl get pods --all-namespaces
kubectl apply -f https://raw.githubusercontent.com/kata-containers/kata-containers/main/tools/packaging/kata-deploy/runtimeclasses/kata-runtimeClasses.yaml
```

## Test Default Installation
To test with a `QEMU` hypervisor ([reference](https://github.com/kata-containers/kata-containers/blob/main/tools/packaging/kata-deploy/README.md))
```bash
kubectl create namespace kata-qemu
kubectl apply \
    -n kata-qemu \
    -f https://raw.githubusercontent.com/kata-containers/kata-containers/main/tools/packaging/kata-deploy/examples/test-deploy-kata-qemu.yaml
kubectl get pods -n kata-qemu
```
And you can stop the pod with
```bash
kubectl delete \
    -n kata-qemu \
    -f https://raw.githubusercontent.com/kata-containers/kata-containers/main/tools/packaging/kata-deploy/examples/test-deploy-kata-qemu.yaml
```
Alternatively, follow the instructions the above referenced [blog post](https://aws.amazon.com/blogs/containers/enhancing-kubernetes-workload-isolation-and-security-using-kata-containers/) to install and test the `redis` pod (and adapt the runtime from `kata-fc` to `kata-qemu`).

### <a name="kata-sev-snp"></a>Test with SEV-SNP Support

Install via [confidential containers](COCO.md). And then, with the `redis` pod, use the `kata-qemu-snp` runtime.

## Test Custom QEMU built with the Custom Ubuntu EKS Image

_The following instruction will eventually be automated_

Via the console, connect to the worker node with AWS Session Manager. Then install `vim` via
```bash
sudo apt install -y vim
```
and edit the file `/opt/kata/share/defaults/kata-containers/configuration-qemu.toml`. On line 15, replace `/opt/kata/bin/qemu-system-x86_64` with `/home/ubuntu/src/AMDSEV/usr/local/bin/qemu-system-x86_64`. Then validate with the instructions in the previous section. You can validate that the selected `qemu` binary was used with running `ps -Af|grep qemu` on the worker node.