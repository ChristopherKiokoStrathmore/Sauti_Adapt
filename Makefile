# Local development only. All tokens live in an ignored .env file.
.PHONY: dev down

dev:
	docker compose up --build

down:
	docker compose down
