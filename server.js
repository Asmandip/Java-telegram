import express from "express";
import fetch from "node-fetch";
import dotenv from "dotenv";
import { MongoClient } from "mongodb";

dotenv.config();
const app = express();
const PORT = process.env.PORT || 3000;

// Ensure MONGO_URI exists
if (!process.env.MONGO_URI) {
  console.error("❌ MONGO_URI missing in environment variables");
  process.exit(1);
}

let db;

// MongoDB connection
async function connectDB() {
  try {
    const mongoClient = new MongoClient(process.env.MONGO_URI, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
    });
    await mongoClient.connect();
    db = mongoClient.db("asman_trade_logs");
    console.log("✅ MongoDB connected");
  } catch (err) {
    console.error("❌ MongoDB connection failed:", err);
    process.exit(1);
  }
}

app.use(express.json());

// Root route
app.get("/", (req, res) => {
  res.send("🚀 AsmanDip Java Telegram Bot Server Running...");
});

// Example API: Send Telegram Message
app.post("/send-signal", async (req, res) => {
  try {
    const { pair, rsi } = req.body;

    if (!pair || rsi === undefined) {
      return res.status(400).json({ success: false, error: "Missing pair or rsi" });
    }

    // Save to MongoDB
    await db.collection("signals").insertOne({
      pair,
      rsi,
      time: new Date()
    });

    // Send to Telegram
    const message = `📢 Signal Alert\nPair: ${pair}\nRSI: ${rsi}\nTime: ${new Date().toLocaleString()}`;
    const telegramURL = `https://api.telegram.org/bot${process.env.TELEGRAM_TOKEN}/sendMessage`;

    const tgRes = await fetch(telegramURL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: process.env.CHAT_ID,
        text: message
      })
    });

    if (!tgRes.ok) {
      throw new Error(`Telegram API Error: ${tgRes.statusText}`);
    }

    res.status(200).json({ success: true, message: "Signal sent to Telegram" });
  } catch (err) {
    console.error("❌ Error sending signal:", err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// Start server only after DB connection
connectDB().then(() => {
  app.listen(PORT, () => {
    console.log(`✅ Server running on port ${PORT}`);
  });
});

// Prevent app crash on unhandled rejections
process.on("unhandledRejection", (reason) => {
  console.error("❌ Unhandled Rejection:", reason);
});