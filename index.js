const http = require("http");

// In-memory ticket store for this exercise.
const tickets = [];
let nextTicketNumber = 1001;
const idempotencyKeys = new Map();

// Business rule values used by validation.
const allowedPriorities = new Set(["low", "medium", "high"]);
const allowedStatuses = new Set(["open", "in_progress", "resolved"]);

// Send all API responses as JSON.
function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
  });
  res.end(JSON.stringify(payload));
}

// Read the full request body before parsing JSON.
function readRequestBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";

    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > 1_000_000) {
        reject(new Error("Request body too large"));
        req.destroy();
      }
    });

    req.on("end", () => resolve(body));
    req.on("error", reject);
  });
}

// Convert the raw body into an object and raise a clear error on bad JSON.
function parseJsonBody(rawBody) {
  if (!rawBody) {
    return {};
  }

  try {
    return JSON.parse(rawBody);
  } catch {
    throw new Error("Invalid JSON payload");
  }
}

// Enforce required fields and allowed priority values for new tickets.
function validateTicketCreation(payload) {
  const errors = [];

  if (typeof payload.title !== "string" || payload.title.trim() === "") {
    errors.push("title is required");
  }

  if (
    typeof payload.description !== "string" ||
    payload.description.trim() === ""
  ) {
    errors.push("description is required");
  }

  if (
    typeof payload.priority !== "string" ||
    !allowedPriorities.has(payload.priority)
  ) {
    errors.push("priority must be one of: low, medium, high");
  }

  return errors;
}

// Enforce allowed status values when updating a ticket.
function validateStatus(payload) {
  if (
    typeof payload.status !== "string" ||
    !allowedStatuses.has(payload.status)
  ) {
    return "status must be one of: open, in_progress, resolved";
  }

  return null;
}

// Look up a ticket by its generated ID.
function getTicketById(id) {
  return tickets.find((ticket) => ticket.id === id);
}

function parsePositiveInteger(value, defaultValue) {
  if (value === undefined) {
    return defaultValue;
  }

  const parsedValue = Number(value);

  if (!Number.isInteger(parsedValue) || parsedValue <= 0) {
    return null;
  }

  return parsedValue;
}

function createPayloadSignature(payload) {
  return JSON.stringify({
    title: payload.title.trim(),
    description: payload.description.trim(),
    priority: payload.priority,
  });
}

// Main HTTP router for the ticket API.
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);

  // Create a new ticket.
  if (req.method === "POST" && url.pathname === "/api/tickets") {
    try {
      const body = parseJsonBody(await readRequestBody(req));
      const errors = validateTicketCreation(body);
      const idempotencyKey = req.headers["idempotency-key"];

      if (errors.length > 0) {
        return sendJson(res, 400, {
          error: "Invalid ticket data",
          details: errors,
        });
      }

      const payloadSignature = createPayloadSignature(body);

      if (idempotencyKey) {
        const existingEntry = idempotencyKeys.get(idempotencyKey);

        if (existingEntry) {
          if (existingEntry.payloadSignature !== payloadSignature) {
            return sendJson(res, 400, {
              error:
                "Idempotency-Key already used with a different request body",
            });
          }

          return sendJson(res, 200, existingEntry.ticket);
        }
      }

      const ticket = {
        id: `TKT-${nextTicketNumber++}`,
        title: body.title.trim(),
        description: body.description.trim(),
        priority: body.priority,
        status: "open",
        createdAt: new Date().toISOString(),
      };

      tickets.push(ticket);

      if (idempotencyKey) {
        idempotencyKeys.set(idempotencyKey, {
          payloadSignature,
          ticket,
        });
      }

      return sendJson(res, 201, ticket);
    } catch (error) {
      return sendJson(res, 400, { error: error.message });
    }
  }

  // Return all tickets, optionally filtered by status.
  if (req.method === "GET" && url.pathname === "/api/tickets") {
    const { status } = Object.fromEntries(url.searchParams.entries());
    const shouldPaginate =
      url.searchParams.has("page") || url.searchParams.has("limit");
    const page = parsePositiveInteger(url.searchParams.get("page"), 1);
    const limit = parsePositiveInteger(url.searchParams.get("limit"), 10);

    if (status !== undefined && !allowedStatuses.has(status)) {
      return sendJson(res, 400, {
        error: "status query must be one of: open, in_progress, resolved",
      });
    }

    if (page === null || limit === null) {
      return sendJson(res, 400, {
        error: "page and limit must be positive integers",
      });
    }

    const filteredTickets = status
      ? tickets.filter((ticket) => ticket.status === status)
      : tickets;

    if (!shouldPaginate) {
      return sendJson(res, 200, filteredTickets);
    }

    const startIndex = (page - 1) * limit;
    const pagedTickets = filteredTickets.slice(startIndex, startIndex + limit);

    return sendJson(res, 200, {
      data: pagedTickets,
      page,
      limit,
      total: filteredTickets.length,
      totalPages: Math.max(1, Math.ceil(filteredTickets.length / limit)),
    });
  }

  // Match routes for a single ticket and the status update endpoint.
  const ticketMatch = url.pathname.match(/^\/api\/tickets\/([^/]+)$/);
  const statusMatch = url.pathname.match(/^\/api\/tickets\/([^/]+)\/status$/);

  // Return one ticket by ID.
  if (req.method === "GET" && ticketMatch) {
    const ticket = getTicketById(ticketMatch[1]);

    if (!ticket) {
      return sendJson(res, 404, { error: "Ticket not found" });
    }

    return sendJson(res, 200, ticket);
  }

  // Update ticket status only.
  if (req.method === "PATCH" && statusMatch) {
    try {
      const ticket = getTicketById(statusMatch[1]);

      if (!ticket) {
        return sendJson(res, 404, { error: "Ticket not found" });
      }

      const body = parseJsonBody(await readRequestBody(req));
      const statusError = validateStatus(body);

      if (statusError) {
        return sendJson(res, 400, {
          error: "Invalid status update",
          details: [statusError],
        });
      }

      ticket.status = body.status;
      return sendJson(res, 200, ticket);
    } catch (error) {
      return sendJson(res, 400, { error: error.message });
    }
  }

  return sendJson(res, 404, { error: "Route not found" });
});

// Start the server on the configured port or the default port 3000.
const port = Number(process.env.PORT) || 3000;

server.listen(port, () => {
  console.log(`Ticket API listening on port ${port}`);
});
