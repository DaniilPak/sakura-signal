// index.js
require("dotenv").config(); // Load environment variables

const express = require("express");
const http = require("http");
const socketIo = require("socket.io");
const axios = require("axios");
const bodyParser = require("body-parser");

const app = express();

// Middleware to parse JSON bodies
app.use(bodyParser.json());

// Create HTTP server
const server = http.createServer(app);

// Initialize Socket.IO
const io = socketIo(server, {
  cors: {
    origin: process.env.CORS_ORIGIN || "*", // Set specific origin in production
    methods: ["GET", "POST"],
  },
});

// Configuration
const PORT = process.env.PORT || 3000;
const MEDIA_SERVER_URL =
  process.env.MEDIA_SERVER_URL || "http://localhost:5000";
const MEDIA_SERVER_API_KEY =
  process.env.MEDIA_SERVER_API_KEY || "your-secret-key";

// Mapping of clientId to Socket.IO socket
const clientSocketMap = new Map();

// Middleware to verify media server requests
const verifyMediaServer = (req, res, next) => {
  const apiKey = req.headers["x-api-key"];
  if (apiKey && apiKey === MEDIA_SERVER_API_KEY) {
    next();
  } else {
    res.status(401).json({ message: "Unauthorized" });
  }
};

// Socket.IO connection handler
io.on("connection", (socket) => {
  console.log(`Client connected: ${socket.id}`);

  // Optional: Register client with a custom clientId
  socket.on("register", (data) => {
    const { clientId } = data;
    if (clientId) {
      clientSocketMap.set(clientId, socket);
      console.log(`Registered clientId ${clientId} with socket ${socket.id}`);
    }
  });

  // Handle SDP Offer from client
  socket.on("sdp-offer", async (data) => {
    try {
      console.log(`Received SDP Offer from ${socket.id}`);

      // Forward the SDP offer to the media server
      await axios.post(
        `${MEDIA_SERVER_URL}/process-sdp`,
        {
          sdp: data.sdp,
          clientId: socket.id, // Use socket.id as clientId
        },
        {
          headers: {
            "x-api-key": MEDIA_SERVER_API_KEY, // If required by media server
          },
        }
      );

      // The media server is expected to send back a POST request to our microservice
    } catch (error) {
      console.error("Error processing SDP Offer:", error.message);
      socket.emit("error", { message: "Failed to process SDP Offer" });
    }
  });

  // Handle disconnection
  socket.on("disconnect", () => {
    console.log(`Client disconnected: ${socket.id}`);
    // Remove from clientSocketMap
    for (let [key, value] of clientSocketMap.entries()) {
      if (value.id === socket.id) {
        clientSocketMap.delete(key);
        break;
      }
    }
    // Notify media server about disconnection
    axios
      .post(
        `${MEDIA_SERVER_URL}/disconnect`,
        { clientId: socket.id },
        {
          headers: {
            "x-api-key": MEDIA_SERVER_API_KEY, // If required by media server
          },
        }
      )
      .catch((err) =>
        console.error("Error notifying media server:", err.message)
      );
  });
});

// --- Express POST Routes to Receive from Media Server ---

/**
 * Route: POST /media-server/answer
 * Description: Receive SDP answer from media server and send it to the appropriate client
 * Expected Body: { clientId: string, sdpAnswer: string }
 */
app.post("/media-server/answer", verifyMediaServer, (req, res) => {
  const { clientId, sdpAnswer } = req.body;

  if (!clientId || !sdpAnswer) {
    return res
      .status(400)
      .json({ message: "clientId and sdpAnswer are required" });
  }

  const clientSocket = clientSocketMap.get(clientId);

  if (clientSocket) {
    clientSocket.emit("sdp-answer", { sdp: sdpAnswer });
    console.log(`Sent SDP answer to client ${clientId}`);
    res.status(200).json({ message: "SDP answer sent to client" });
  } else {
    console.warn(`Socket not found for clientId ${clientId}`);
    res.status(404).json({ message: "Client not connected" });
  }
});

/**
 * Route: POST /media-server/some-other-route
 * Description: Additional routes as needed
 * Implement similar logic for other types of messages from media server
 */

// Start the server
server.listen(PORT, () => {
  console.log(`Socket.IO server running on port ${PORT}`);
});
