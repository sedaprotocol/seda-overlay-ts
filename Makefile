.PHONY: build run stop up clean logs ssh init stake info withdraw unstake

# Environment variables (consider using a .env file)
# SEDA_NETWORK=testnet
# SEDA_MNEMONIC="your mnemonic phrase here"
# SEDA_AMOUNT=32 # Example stake amount for stake command

# Define the docker-compose file location
DOCKER_COMPOSE_FILE := .build/docker/docker-compose.yaml

# Build the Docker image
build:
	docker compose -f $(DOCKER_COMPOSE_FILE) build

# Run the Docker container in detached mode
run:
	docker compose -f $(DOCKER_COMPOSE_FILE) up -d

# Stop the Docker container
stop:
	docker compose -f $(DOCKER_COMPOSE_FILE) down

# Build and run the Docker container
up: build run

# Clean up Docker resources
clean:
	docker compose -f $(DOCKER_COMPOSE_FILE) down --rmi all --volumes --remove-orphans

# Show logs
logs:
	docker compose -f $(DOCKER_COMPOSE_FILE) logs -f

# SSH into the running container
ssh:
	docker compose -f $(DOCKER_COMPOSE_FILE) exec seda-overlay sh

# --- SEDA Overlay Commands ---

# Initialize the node (creates config in the mapped ./.seda volume)
init:
	@echo "Initializing SEDA Overlay Node for network: $${SEDA_NETWORK:-testnet}..."
	@echo "Ensure SEDA_MNEMONIC is set in your environment or .env file."
	docker compose -f $(DOCKER_COMPOSE_FILE) run --rm seda-overlay init --network $${SEDA_NETWORK:-testnet}
	@echo "Initialization complete. Check and edit the config file in ./.seda/$${SEDA_NETWORK:-testnet}/config.jsonc if needed."

# Stake SEDA tokens
stake:
	@echo "Staking $${SEDA_AMOUNT} SEDA on network: $${SEDA_NETWORK:-testnet}..."
	@echo "Ensure SEDA_MNEMONIC and SEDA_AMOUNT are set in your environment or .env file."
	@[ "$${SEDA_AMOUNT}" ] || ( echo "Error: SEDA_AMOUNT environment variable is not set."; exit 1 )
	docker compose -f $(DOCKER_COMPOSE_FILE) run --rm seda-overlay identities stake $${SEDA_AMOUNT} --network $${SEDA_NETWORK:-testnet}

# Check identity status
info:
	@echo "Checking identity status on network: $${SEDA_NETWORK:-testnet}..."
	docker compose -f $(DOCKER_COMPOSE_FILE) run --rm seda-overlay identities info --network $${SEDA_NETWORK:-testnet}

# Withdraw rewards
withdraw:
	@echo "Withdrawing rewards on network: $${SEDA_NETWORK:-testnet}..."
	docker compose -f $(DOCKER_COMPOSE_FILE) run --rm seda-overlay identities withdraw --network $${SEDA_NETWORK:-testnet}

# Unstake node
unstake:
	@echo "Unstaking node on network: $${SEDA_NETWORK:-testnet}..."
	docker compose -f $(DOCKER_COMPOSE_FILE) run --rm seda-overlay identities unstake --network $${SEDA_NETWORK:-testnet}
