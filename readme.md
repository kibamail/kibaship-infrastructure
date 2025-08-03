# How to setup a cluster on hetzner bare metal

## Purchasing the bare metal servers

On hetzner, when you purchase the bare metal servers, you need to make sure to:

- Configure ssh key access so we can get into the server via ssh as root
- Must be NVMe drives, for the fastest possible IOPS we can get from bare metal servers.
- Only select rescue mode as the server type. This ensures no operating system is installed on the server, and we can manually disable RAID 1 before installing the operating system.

The reason we must disable RAID 1 is because we need mayastor storage to be able to use the entire disk space and control redundancy across the entire cluster.

## Installing the operating system

Once you connect to the server using `ssh root@<ip>`, you will be connected to the rescue system. You need to run the following command to install the operating system:

```bash
installimage
```

This is a program created by Hetzner Online GmbH. It is used to install the operating system on the server.
This command brings up an interactive editor we can use to configure the installation.
In this, we need to configure the following:

- Choose the operating system to install. Make sure to select `Ubuntu` and then `Ubuntu 24.04 LTS`.
- Set `SWRAID 0`. This will disable raid, ensuring all 2 drives attached to the server are treated independently.
- Set the hostname to something like `control-plane-1.staging.kibaship.com`
- Save the file, exit, and then the installation will begin.

Finally, run `reboot` and wait for the server to come back online. Once it does, if you ssh again, you'll be brought into the actual ubuntu operating system.

## Setting up private network across servers

First, on the hetzner robot dashboard, create a vswitch. This will route traffic between all bare metal servers via a private network.

Then, add all bare metal servers in the cluster to the vswitch from the dashboard.

Finally, in each server, we need to edit the netplan configuration file to enable the private network.

```bash
nano /etc/netplan/01-netcfg.yaml
```

```bash
### Hetzner Online GmbH installimage
network:
  version: 2
  renderer: networkd
  ethernets:
    enp9s0:
      addresses:
        - 65.108.123.27/32
        - 2a01:4f9:6b:1299::2/64
      routes:
        - on-link: true
          to: 0.0.0.0/0
          via: 65.108.123.1
        - to: default
          via: fe80::1
      nameservers:
        addresses:
          - 185.12.64.1
          - 2a01:4ff:ff00::add:2
          - 185.12.64.2
          - 2a01:4ff:ff00::add:1
### Add these lines here
  vlans:
    vlan4001:
     id: 4001
     link: enp9s0 # <--- this must correspond to the name of the ethernet interface for the server
     mtu: 1400
     addresses:
       - 192.168.1.13/24 # <--- this unique ip address will identify the server in the private network. All other servers must also define the /24 subnet.
```

Then, run `netplan apply` to apply the changes.

In order to persist these changes across reboots, add the following line to the crontab file.

First run `sudo crontab -e` to bring up the editor, and then add this line to the bottom of the file:

```bash
@reboot sleep 10 && /sbin/ip link set mtu 1400 dev vlan4001
```

This command tells the server to wait for 10 seconds after a reboot and then set the MTU of the vlan4001 interface to 1400.

### Setup sudo user

For secure access, we'll create a user called `kibaship` with sudo privileges on all nodes of the cluster.

Run the following commands to create the user and grant sudo privileges:

```bash
sudo useradd kibaship
sudo usermod -aG sudo kibaship
```

When prompted for a password, generate a unique password for the user on Proton, our secrets manager, and enter that password here. Make sure to save the password on Proton as a credential.

### Setup SSH keys

For each node in the cluster, run the following command to copy the ssh keys into the server, enabling ssh login as that user:

```bash
ssh-copy-id -i .secrets/staging/id_ed25519 kibaship@<node-ip>
```

If you don't have an ssh key pair, copy the stored one from Proton to your local machine before running the command.


## Load balancer setup






-------> K8S CLUSTER
        ---> KIBAMAIL
              -----> USER VISITS KIBAMAIL DASHBOARD on kibamail.com/dashboard
                    1. kibamail.com/dashboard is pointing to api gateway (load balancer)
                    2. api gateway is pointing to K8S cluster worker nodes
                    3. k8s cluster worker nodes receive request, detect that it came from kibamail.com/dashboard
                    4. k8s cluster worker nodes send traffic to kibamail pods
                    5. pods handle request
        ---> KIBAMAIL IS DEPLOYED TO K8S CLUSTER
              -----> DEVELOPER ON KIBAMAIL WANTS TO ADD A NEW DATABASE
                    1. Visit kibaship dashboard (Our own vercel)
                    2. Create new database
                    3. Kibaship will connect to Kubernetes cluster via API (api gateway just for the kubernetes cluster)
                    4. Kibaship will provision a new database inside the cluster
                    5. Kibaship will return database url to developer
                    6. Developer will use database url in kibamail app to connect to database


## Preparing nodes for mayastor storage

Ensure all nodes meet these requirements:

https://openebs.io/docs/quickstart-guide/prerequisites#replicated-pv-mayastor-prerequisites

## Networking

In order to allow k8 components connect to control planes via load balancer using private ip, ensure that the following is added to each node's /etc/hosts file:

```bash
192.168.0.2 kube.staging.kibaship.com
```

This will ensure that when any component tries to resolve kube.staging.kibaship.com:6443, it automatically points to the private IP address of the load balancer, which points to the control plane nodes.

# Initialise k8s cluster

```bash
sudo kubeadm init --config kubeadm.config.yaml --upload-certs
```


```bash
Your Kubernetes control-plane has initialized successfully!

To start using your cluster, you need to run the following as a regular user:

  mkdir -p $HOME/.kube
  sudo cp -i /etc/kubernetes/admin.conf $HOME/.kube/config
  sudo chown $(id -u):$(id -g) $HOME/.kube/config

Alternatively, if you are the root user, you can run:

  export KUBECONFIG=/etc/kubernetes/admin.conf

You should now deploy a pod network to the cluster.
Run "kubectl apply -f [podnetwork].yaml" with one of the options listed at:
  https://kubernetes.io/docs/concepts/cluster-administration/addons/

You can now join any number of control-plane nodes running the following command on each as root:

  kubeadm join kube.staging.kibaship.com:6443 --token abcd.xxx \
	--discovery-token-ca-cert-hash sha256:xxx \
	--control-plane --certificate-key xxx

Please note that the certificate-key gives access to cluster sensitive data, keep it secret!
As a safeguard, uploaded-certs will be deleted in two hours; If necessary, you can use
"kubeadm init phase upload-certs --upload-certs" to reload certs afterward.

Then you can join any number of worker nodes by running the following on each as root:

kubeadm join kube.staging.kibaship.com:6443 --token abcd.xxx \
	--discovery-token-ca-cert-hash sha256:xxx
```

After bootstraping the cluster control plane, next we need to bootstrap the worker nodes by copying the configuration file kubeadm.config.worker.yaml and running the following command on each as a sudo user:

```bash
sudo kubeadm join --config kubeadm.config.worker.yaml
```

## Setting up cilium cli

```bash
CILIUM_CLI_VERSION=v0.18.6
CLI_ARCH=amd64
if [ "$(uname -m)" = "aarch64" ]; then CLI_ARCH=arm64; fi
curl -L --fail --remote-name-all https://github.com/cilium/cilium-cli/releases/download/${CILIUM_CLI_VERSION}/cilium-linux-${CLI_ARCH}.tar.gz{,.sha256sum}
sha256sum --check cilium-linux-${CLI_ARCH}.tar.gz.sha256sum
sudo tar xzvfC cilium-linux-${CLI_ARCH}.tar.gz /usr/local/bin
rm cilium-linux-${CLI_ARCH}.tar.gz{,.sha256sum}

```

install the crds required for gateway api support:

```bash
kubectl apply -f https://raw.githubusercontent.com/kubernetes-sigs/gateway-api/v1.2.0/config/crd/standard/gateway.networking.k8s.io_gatewayclasses.yaml
kubectl apply -f https://raw.githubusercontent.com/kubernetes-sigs/gateway-api/v1.2.0/config/crd/standard/gateway.networking.k8s.io_gateways.yaml
kubectl apply -f https://raw.githubusercontent.com/kubernetes-sigs/gateway-api/v1.2.0/config/crd/standard/gateway.networking.k8s.io_httproutes.yaml
kubectl apply -f https://raw.githubusercontent.com/kubernetes-sigs/gateway-api/v1.2.0/config/crd/standard/gateway.networking.k8s.io_referencegrants.yaml
kubectl apply -f https://raw.githubusercontent.com/kubernetes-sigs/gateway-api/v1.2.0/config/crd/standard/gateway.networking.k8s.io_grpcroutes.yaml
```

```bash
cilium install \
  --version 1.18.0 \
  --set k8sServiceHost=kube.staging.kibaship.com \
  --set k8sServicePort=6443 \
  --set kubeProxyReplacement=true \
  --set tunnelProtocol=vxlan \
  --set gatewayAPI.enabled=true \
  --set gatewayAPI.hostNetwork.enabled=true \
  --set gatewayAPI.hostNetwork.nodeLabelSelector="ingress-ready=true" \
  --set ipam.mode=cluster-pool \
  --set loadBalancer.mode=snat \
  --set operator.replicas=2 \
  --set bpf.masquerade=true
```

These three configurations are the most important:

```bash
--set gatewayAPI.enabled=true \
--set gatewayAPI.hostNetwork.enabled=true \
--set gatewayAPI.hostNetwork.nodeLabelSelector="ingress-ready=true" \
```

This enables gateway api support, and will run all gateways on the specified ports on the nodes that match the label selector. On staging, all nodes have this selector.

Now our external load balancer will just point to port 30080 and 30443 on each node to handle ingress traffic.
