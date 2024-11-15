These instructions create an EKS cluster, with a managed node-group. The managed node-group creates two worker nodes using the custom AMI with SEV-SNP support.

Use the `sev-snp-ubuntu-metal-cluster-template.yaml` template to create a cluster configuration file. You can name it `sev-snp-ubuntu-metal-cluster.yaml`. Use the following command to deploy the cluster
```bash
REGION=region_code
CLUSTER_NAME=sev-snp-metal-cluster
eksctl create cluster \
    --without-nodegroup \
    -f sev-snp-ubuntu-metal-cluster.yaml
aws eks update-kubeconfig --region ${REGION} --name ${CLUSTER_NAME}
kubectl get svc
```
Then use the `sev-snp-ubuntu-metal-managed-template.yaml` template to create a node-group for this cluster. You can name it `sev-snp-ubuntu-metal-managed.yaml`. Use the following command to deploy the node-group
```bash
eksctl create nodegrroup \
    -f sev-snp-ubuntu-metal-managed.yaml
kubectl get nodes
```
