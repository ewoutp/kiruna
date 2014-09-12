FROM subliminl/docker-node-base
MAINTAINER Ewout Prangsma [ewout AT subliminl.com]

# Setup environment 
ENV KIRUNA_CONF /app/kiruna.conf

# Start
CMD ["/app/start.sh"]
