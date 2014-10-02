FROM docker-node-base
MAINTAINER Ewout Prangsma [ewout AT subliminl.com]

# Setup environment 
ENV KIRUNA_CONF /app/kiruna.conf
RUN mkdir -p /app/config

# Start
CMD ["/app/start.sh"]
