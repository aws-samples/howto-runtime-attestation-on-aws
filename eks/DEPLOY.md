# HOWTO: Deploy an EKS Cluster

These instructions create an EKS cluster, with a managed node-group. The managed node-group creates one worker node using the custom AMI with SEV-SNP support (and spot request).

Use the `cluster-template.yaml` template to create a cluster configuration file. You can name it `cluster.yaml`. Use the following command to deploy the cluster
```bash
REGION=region_code # e.g. eu-central-1
CLUSTER_NAME=sev-snp-metal-cluster
eksctl create cluster \
    --without-nodegroup \
    -f cluster.yaml
aws eks update-kubeconfig --region ${REGION} --name ${CLUSTER_NAME}
kubectl get svc
```
Then use the `managed-sev-snp-metal-ubuntu-template.yaml` template to create a node-group for this cluster. You can name it `metal-sev-snp-metal-ubuntu.yaml`. Use the following command to deploy the node-group
```bash
eksctl create nodegroup \
    -f managed-sev-snp-metal-ubuntu.yaml
kubectl get nodes
```

# Next Steps

You can experiment with [Kata](KATA.md) and [confidential](COCO.md) containers: see [KATA.md](KATA.md) and [COCO.md](COCO.md), respectively. Support for Kata with SEV-SNP has been validated using the [confidential containers](COCO.md) related instructions.