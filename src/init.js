// Firebase Admin SDK: to interact with the Firestore database
const admin = require('firebase-admin');
// initialize firebase admin sdk without parameters
admin.initializeApp();
// to write server-timestamps to database docs
admin.firestore().settings({ timestampsInSnapshots: true });
// initialize firestore database
const db = admin.firestore();

module.exports = {
  admin,
  db
}