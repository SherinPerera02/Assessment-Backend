## Assessment Backend

Small Node.js REST API for tracking IT support tickets in memory.

### Installation and Startup

npm install
npm start

The server runs on port `3000` by default. To use a different port:


### Base URL

`http://localhost:3000`

### Endpoints

- `POST /api/tickets` - Create a new ticket
- `GET /api/tickets` - Return all tickets
- `GET /api/tickets?status=open` - Filter tickets by status
- `GET /api/tickets/:id` - Return one ticket by ID
- `PATCH /api/tickets/:id/status` - Update ticket status only

### Example Request

Create a ticket:

```bash
curl -X POST http://localhost:3000/api/tickets \
	-H "Content-Type: application/json" \
	-d '{"title":"Cannot access company email","description":"Login shows an authentication error.","priority":"high"}'
```

Example success response:

```json
{
	"id": "TKT-1001",
	"title": "Cannot access company email",
	"description": "Login shows an authentication error.",
	"priority": "high",
	"status": "open",
	"createdAt": "2026-08-09T00:00:00.000Z"
}
```

### Example Error Response

```json
{
	"error": "Invalid ticket data",
	"details": [
		"title is required",
		"description is required",
		"priority must be one of: low, medium, high"
	]
}
```

### Production Improvements

For production, this service should use a real database for persistence, add authentication and authorization for IT staff, enable structured logging, add automated tests, apply rate limiting, and deploy behind a managed platform or container service.
