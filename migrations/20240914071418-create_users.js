module.exports = {
  async up(db) {
    await db.createCollection("users");

    await db.collection("users").insertOne({
      username: "admin",
      password: "6b86b273ff34fce19d6b804eff5a3f5747ada4eaa22f1d49c01e52ddb7875b4b",
    });
  },

  async down(db) {
    await db.dropDatabase();
  },
};
