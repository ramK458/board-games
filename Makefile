.PHONY: init seed install dev-backend dev-frontend frontend-install test

init:
	@mkdir -p _db
	@echo "_db/ directory ready"

install:
	pip install -r backend/requirements.txt

seed:
	@echo "Running seed script..."
	PYTHONPATH=.. python backend/seed.py

dev-backend:
	PYTHONPATH=.. uvicorn backend.main:app --reload --host 0.0.0.0 --port 8000

frontend-install:
	cd frontend && npm install

dev-frontend:
	cd frontend && npm run dev

test:
	@echo "Test placeholder — add test runner later"
