require("dotenv").config();
const { Router } = require("express");
const { MongoClient, ObjectId } = require("mongodb");

const router = Router({});

let db;

(async () => {
  const clientPromise = MongoClient.connect(process.env.DB_URI, { maxPoolSize: 10 });
  const client = await clientPromise;
  db = client.db("timers");
})();

setInterval(() => {
  updateTimer(db, { isActive: true }, { $inc: { progress: 1000 } });
}, 1000);

async function findUserIdBySessionId(db, sessionId) {
  const session = await db.collection("sessions").findOne({ sessionId }, { projection: { userId: 1 } });

  if (!session) return;

  return session.userId;
}

async function createTimer(db, description, userId) {
  const { insertedId } = await db.collection("timers").insertOne({
    userId,
    description,
    isActive: true,
    start: Date.now(),
    progress: 0,
    end: Date.now(),
    duration: 0,
  });

  return insertedId;
}

async function updateTimer(db, where, data) {
  // if (!db) return;

  const timers = await db.collection("timers").find(where).toArray();

  const validTimers = timers.filter((timer) => typeof timer.progress === "number");

  if (validTimers.length > 0) {
    await db.collection("timers").updateMany({ _id: { $in: validTimers.map((timer) => timer._id) } }, data);
  }
}
// async function updateTimer(db, where, data) {
//   if (db) await db.collection("timers").updateMany(where, data);
// }

// Get Timers
// router.get("/", async (req, res) => {
//   const isActive = req.query.isActive === "true";
//   const userId = await findUserIdBySessionId(req.db, req.cookies.sessionId);
//   const currentTimers = await getTimers(req.db, { isActive, userId });

//   currentTimers.forEach((timer) => {
//     timer.id = timer._id;
//   });

//   return res.json(currentTimers);
// });

// Timer Start
router.post("/", async (req, res) => {
  const description = req.body.description;

  if (!description) return;

  const userId = await findUserIdBySessionId(req.db, req.cookies.sessionId);
  const timerId = await createTimer(req.db, description, userId);

  return res.json({ id: timerId });
});

// Timer Stop
router.post("/:id/stop", async (req, res) => {
  const timerId = req.params.id;

  const timerNewData = [
    {
      $set: {
        isActive: false,
        duration: "$progress",
        end: Date.now(),
      },
    },
  ];

  await updateTimer(req.db, { _id: ObjectId.createFromHexString(timerId) }, timerNewData);

  return res.json(timerId);
});

module.exports = router;
