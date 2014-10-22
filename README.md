Kiruna
======

Docker orchestration and watchdog.

What does it do
---------------

Kiruna is a service that you run on your docker host (typically inside a docker container) and feed with a kiruna.conf configuration file.
It will:
- Start services from this config file
- Monitor their health (and restart them when needed)
- Monitor the config file for changes  (so you can just push it with tools like Ansible, Chef etc. and kiruna will act upon it)
- Register IP/port pairs for each of the services with ETCD for use by load balancers etc.

Configuration file
------------------

The configuration file is called kiruna.conf and must be accessible in the root of this project or in an environment variable called KIRUNA_CONF.

It is a JSON file with the following structure.

{
"Variables": {
    "key": "value"
},
"Registration": {
    "Host": "host-ip of etcd server",
    "Port": "4001",
    "Ip": "",
    "Ttl": "ttl-of-registrations",
    "Prefix": "prefix-in-etcd-key-space"
},
"Defaults": {
    "any-service-key": "value"
},
"Services": {
    "service-name": {
        "HardDeploy": "if-true-stop-old-container-then-restart",
        "Registry": "custom-registry-host-colon-port",
        "Image": "docker-image-name",
        "Tag": "docker-image-tag",
        "Enabled": "true|false",
        "PublishAllPorts": "true|false",
        "Dependencies": ["other-service-name"],
        "SettleTimeout": "time-needed-by-load-balancers-etc-after-a-start-in-ms",
        "NetworkMode": "any-docker-network-mode",
        "Ports": {
            "container-port": "host-port"
        },
        "Health": {
             "Http": {
                "Port": "docker-port-to-check-on",
                "Ip": "ip-address-to-check-on (for public IP mapping)",
                "Path": "/this-is-my-health-indicator"
            }
        },
        "Environment": {
            "key": "value"
        },
        "Volumes": {
            "container-path": "host-path"
        }
    }
}
}
