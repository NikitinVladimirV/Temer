require("dotenv").config();

const express = require("express");
const http = require("http");
const WebSocket = require("ws");
const nunjucks = require("nunjucks");
const { nanoid } = require("nanoid");
const cookieParser = require("cookie-parser");
const crypto = require("crypto");
const { MongoClient } = require("mongodb");
const { URL } = require("url");

const port = process.env.PORT || 8000;

const app = express();
app.set("view engine", "njk");
app.use(express.json());
app.use(express.static("public"));
app.use(cookieParser());
app.use(async (req, res, next) => {
  try {
    const client = await clientPromise;
    req.db = client.db("timers");
    next();
  } catch (err) {
    next(err);
  }
});
app.use("/api/timers", require("./timers"));
nunjucks.configure("views", {
  autoescape: true,
  express: app,
  tags: {
    blockStart: "[%",
    blockEnd: "%]",
    variableStart: "[[",
    variableEnd: "]]",
    commentStart: "[#",
    commentEnd: "#]",
  },
});

const clientPromise = MongoClient.connect(process.env.DB_URI, { maxPoolSize: 10 });
const server = http.createServer(app);
const wss = new WebSocket.Server({ clientTracking: false, noServer: true });
const clients = new Map();

async function dbConnect() {
  try {
    const client = await clientPromise;

    return client.db("timers");
  } catch (error) {
    throw new Error(error);
  }
}

function auth() {
  return async (req, res, next) => {
    const sessionId = req.cookies["sessionId"];

    if (!sessionId) return next();

    const user = await findUserBySessionId(req.db, sessionId);

    user.sessionId = sessionId;

    req.user = user;
    req.sessionId = sessionId;

    next();
  };
}

function stringToHash(data) {
  return crypto.createHash("sha256").update(data).digest("hex");
}

async function getUserTimers(db, userId) {
  return await db.collection("timers").find({ userId }).toArray();
}

// function parserCookies(headersCookies) {
//   if (!headersCookies) return;

//   const cookies = {};

//   headersCookies = headersCookies.split(";");
//   headersCookies.forEach((cookie) => {
//     const cookieKey = cookie.split("=")[0].trim();
//     const cookieValue = cookie.split("=")[1].trim();
//     cookies[cookieKey] = cookieValue;
//   });

//   return cookies;
// }

function findUserByName(db, username) {
  return db.collection("users").findOne({ username });
}

async function findUserBySessionId(db, sessionId) {
  const session = await db.collection("sessions").findOne({ sessionId }, { projection: { userId: 1 } });

  if (!session) return;

  return await db.collection("users").findOne({ _id: session.userId });
}

async function createSession(db, userId) {
  const sessionId = nanoid();

  await db.collection("sessions").insertOne({
    userId,
    sessionId,
  });

  return sessionId;
}

async function deleteSession(db, sessionId) {
  await db.collection("sessions").deleteOne({ sessionId });
}

// wss.on("connection", (ws) => {
//   console.log("CONNECTION TO WS");

//   // const sessionId = req.headers.cookie ? req.headers.cookie.split("=")[1] : "";

//   // console.log("SESSIONID: ", sessionId);
//   console.log("USER: ", wss.clients[0]);

//   // if (!sessionId) return console.log("Not Unauthorized!");

//   ws.on("message", (message) => {
//     console.log("WS: ", message);

//     let data;

//     try {
//       data = JSON.parse(message);
//     } catch (error) {
//       console.log(error);
//     }

//     console.log(data);

//     if (data.type === "toLogin") {
//       console.log("Type To Login");
//     }

//     ws.send(JSON.stringify({ type: "login2", message }));
//   });
// });

// Get HomePage
app.get("/", auth(), (req, res) => {
  res.render("index", {
    user: req.user,
    authError: req.query.authError,
  });
});

// Login
app.post("/login", express.urlencoded({ extended: false }), async (req, res) => {
  const { username, password } = req.body;

  if (!username) return res.redirect("/?authError=Field 'username' is empty!");
  if (!password) return res.redirect("/?authError=Field 'password' is empty!");

  const user = await findUserByName(req.db, username);

  if (!user) return res.redirect("/?authError=Unnown username!");
  if (user.password !== stringToHash(password)) return res.redirect("/?authError=Wrong password!");

  const sessionId = await createSession(req.db, user._id);

  res.cookie("sessionId", sessionId, { httpOnly: true }).redirect("/");
});

/* eslint-disable-next-line no-unused-vars */
server.on("upgrade", async (req, socket, head) => {
  console.log("UPGRADE");

  const { searchParams } = new URL(req.url, `http://${req.headers.host}`);
  const sessionId = searchParams && searchParams.get("sessionId");
  const db = await dbConnect();
  const userId = sessionId && (await findUserBySessionId(db, sessionId))._id;

  if (!userId) {
    socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
    socket.destroy();

    return;
  }

  req.userId = userId;
  req.db = db;

  wss.handleUpgrade(req, socket, head, (ws) => {
    wss.emit("connection", ws, req);
  });
});

wss.on("connection", async (ws, req) => {
  const { userId } = req;

  clients.set(userId, ws);

  ws.on("close", () => {
    clients.delete(userId);
  });

  setInterval(async () => {
    const userTimers = await getUserTimers(req.db, userId);
    ws.send(JSON.stringify({ type: "all_timers", userTimers }));
  }, 1000);

  ws.on("message", async (message) => {
    let data;

    try {
      data = JSON.parse(message);
    } catch (error) {
      return;
    }

    if (data.type === "all_timers") {
      const userTimers = await getUserTimers(req.db, userId);
      ws.send(JSON.stringify({ type: "all_timers", userTimers }));
    }
  });
});

// Sign Up
app.post("/signup", express.urlencoded({ extended: false }), async (req, res) => {
  const { username, password } = req.body;

  if (!username) return res.redirect("/?authError=Field 'username' is empty!");
  if (!password) return res.redirect("/?authError=Field 'password' is empty!");

  const user = await findUserByName(req.db, username);

  if (user) return res.redirect(`/?authError=User "${username}" already exist!`);

  const { insertedId } = await req.db.collection("users").insertOne({ username, password: stringToHash(password) });
  const sessionId = await createSession(req.db, insertedId);

  return res.cookie("sessionId", sessionId, { httpOnly: true }).redirect("/");
});

// Logout
app.get("/logout", auth(), async (req, res) => {
  if (!req.user) return res.redirect("/");

  await deleteSession(req.db, req.sessionId);

  return res.clearCookie("sessionId").redirect("/");
});

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => res.status(500).send(`OTHER ERRORS: ${err.message}`));
server.listen(port, () => console.log(`  Listening on http://localhost:${port}`));
