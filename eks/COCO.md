# Confidential Containers Deployment

We follow https://github.com/confidential-containers/operator/blob/main/docs/INSTALL.md

Assign label to at least one worker node
```bash
NODENAME=$(kubectl get  nodes -o json | jq .items[0].metadata.name -r)
echo ${NODENAME}
kubectl label node ${NODENAME} node.kubernetes.io/worker=
```

Deploy Operator (version 0.11.0 is the latest as of November 24th 2024)
```bash
export RELEASE_VERSION="v0.11.0"
kubectl apply -k github.com/confidential-containers/operator/config/release?ref=${RELEASE_VERSION}
kubectl get pods -n confidential-containers-system --watch
```
and Custom Resource
```bash
kubectl get crd | grep ccruntime
kubectl apply -k github.com/confidential-containers/operator/config/samples/ccruntime/default?ref=${RELEASE_VERSION}
kubectl get pods -n confidential-containers-system --watch
kubectl get runtimeclass
```

## Test Container with Memory Encryption

See https://github.com/confidential-containers/confidential-containers/blob/main/guides/snp.md to deploy the test container. Then, to test 
```bash
PODNAME=$(kubectl get pods -o json|jq '.items[]|select(.metadata.name | startswith("confidential")) | .metadata.name' -r)
echo ${PODNAME}
kubectl exec -it ${PODNAME} -- sh -c "uname -a"
kubectl exec -it ${PODNAME} -- sh -c 'dmesg|grep "Memory Encryption"'
```

## Test Plain Kata Containers with SEV-SNP Compatible Runtime

Follow the instructions in the following [blog post](https://aws.amazon.com/blogs/containers/enhancing-kubernetes-workload-isolation-and-security-using-kata-containers/) to install and test the `redis` pod. Adapt the runtime from `kata-fc` to `kata-qemu-snp`.